/*
 * Copyright 2022 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
'use strict';

import path from 'path';
import { promises as fs } from 'fs';
import { createPublicKey } from 'crypto';

import {
  addPath,
  exportVariable,
  getInput,
  info as logInfo,
  setFailed,
  setOutput,
  warning as logWarning,
} from '@actions/core';
import { getExecOutput } from '@actions/exec';
import * as toolCache from '@actions/tool-cache';
import {
  authenticateGcloudSDK,
  getLatestGcloudSDKVersion,
  getToolCommand,
  installComponent as installGcloudComponent,
  installGcloudSDK,
  isInstalled as isGcloudInstalled,
} from '@google-github-actions/setup-cloud-sdk';
import {
  errorMessage,
  exactlyOneOf,
  isPinnedToHead,
  parseFlags,
  pinnedToHeadWarning,
  presence,
  randomFilepath,
  stubEnv,
} from '@google-github-actions/actions-utils';

import sshpk from 'sshpk';

import {
  SSH_PUBLIC_KEY_FILENAME,
  SSH_PRIVATE_KEY_FILENAME,
  GOOGLE_SSH_KEYS_TEMP_DIR_VAR,
} from './const';

// Do not listen to the linter - this can NOT be rewritten as an ES6 import
// statement.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { version: appVersion } = require('../package.json');

export async function run(): Promise<void> {
  // Register metrics
  const restoreEnv = stubEnv({
    CLOUDSDK_METRICS_ENVIRONMENT: 'github-actions-ssh-compute',
    CLOUDSDK_METRICS_ENVIRONMENT_VERSION: appVersion,
  });

  // Warn if pinned to HEAD
  if (isPinnedToHead()) {
    logWarning(pinnedToHeadWarning('v0'));
  }

  try {
    // Get inputs
    const instanceName = getInput('instance_name');
    const zone = getInput('zone');
    const user = getInput('user');
    const sshPrivateKey = getInput('ssh_private_key');
    const sshKeysDir = getInput('ssh_keys_dir') || randomFilepath();
    const container = getInput('container');
    const sshArgs = getInput('ssh_args');
    let command = getInput('command');
    const script = getInput('script');
    const projectID = getInput('project_id');
    const gcloudVersion = await computeGcloudVersion(getInput('gcloud_version'));
    const gcloudComponent = presence(getInput('gcloud_component'));
    const flags = getInput('flags');

    exportVariable(GOOGLE_SSH_KEYS_TEMP_DIR_VAR, sshKeysDir);

    if (!exactlyOneOf(command, script)) {
      throw new Error('either `command` or `script` should be set');
    }

    // Validate gcloud component input
    if (gcloudComponent && gcloudComponent !== 'alpha' && gcloudComponent !== 'beta') {
      throw new Error(`invalid input received for gcloud_component: ${gcloudComponent}`);
    }

    const instanceTarget = presence(user) ? `${user}@${instanceName}` : instanceName;

    await fs.mkdir(sshKeysDir, { recursive: true });

    let correctPrivateKeyData = '';
    for (const key of sshPrivateKey.split(/(?=-----BEGIN)/)) {
      correctPrivateKeyData += `${key.trim()}\n`;
    }
    await fs.writeFile(`${sshKeysDir}/${SSH_PRIVATE_KEY_FILENAME}`, correctPrivateKeyData, {
      mode: 0o600,
      flag: 'wx',
    });

    // Get public key from the private key
    const privateKeyObject = sshpk.parsePrivateKey(correctPrivateKeyData, 'ssh-private');

    const pubKeyObject = createPublicKey({
      key: privateKeyObject.toBuffer('pem').toString(),
      format: 'pem',
    });

    const publicKeyPem = pubKeyObject.export({
      format: 'pem',
      type: 'spki',
    });

    const publicKeyPemObject = sshpk.parseKey(publicKeyPem);
    publicKeyPemObject.comment = privateKeyObject.comment;

    await fs.writeFile(
      `${sshKeysDir}/${SSH_PUBLIC_KEY_FILENAME}`,
      publicKeyPemObject.toString('ssh'),
      {
        mode: 0o644,
        flag: 'wx',
      },
    );

    let cmd = [
      'compute',
      'ssh',
      instanceTarget,
      '--zone',
      zone,
      '--ssh-key-file',
      `${sshKeysDir}/${SSH_PRIVATE_KEY_FILENAME}`,
      '--quiet', // we need to ignore prompts from console
      '--tunnel-through-iap',
    ];

    if (container) cmd.push('--container', container);
    if (projectID) cmd.push('--project', projectID);
    if (script) {
      const commandData = (await fs.readFile(script)).toString('utf8');
      command = `bash -c "${commandData}"`;
    }

    // Add optional flags
    if (flags) {
      const flagList = parseFlags(flags);
      if (flagList) cmd = cmd.concat(flagList);
    }

    // Install gcloud if not already installed.
    if (!isGcloudInstalled(gcloudVersion)) {
      await installGcloudSDK(gcloudVersion);
    } else {
      const toolPath = toolCache.find('gcloud', gcloudVersion);
      addPath(path.join(toolPath, 'bin'));
    }

    // Install gcloud component if needed and prepend the command
    if (gcloudComponent) {
      await installGcloudComponent(gcloudComponent);
      cmd.unshift(gcloudComponent);
    }

    // Authenticate - this comes from google-github-actions/auth.
    const credFile = process.env.GOOGLE_GHA_CREDS_PATH;
    if (credFile) {
      await authenticateGcloudSDK(credFile);
      logInfo('Successfully authenticated');
    } else {
      logWarning('No authentication found, authenticate with `google-github-actions/auth`.');
    }

    cmd = [...cmd, '--command', command];

    if (sshArgs) {
      cmd.push(`-- ${sshArgs}`);
    }

    const toolCommand = getToolCommand();
    const options = { silent: true, ignoreReturnCode: true };
    const commandString = `${toolCommand} ${cmd.join(' ')}`;
    logInfo(`Running: ${commandString}`);

    const output = await getExecOutput(toolCommand, cmd, options);

    setOutput('stdout', output.stdout);
    setOutput('stderr', output.stderr);

    if (output.exitCode !== 0) {
      const errMsg = output.stderr || `command exited ${output.exitCode}, but stderr had no output`;
      throw new Error(`failed to execute gcloud command \`${commandString}\`: ${errMsg}`);
    }
  } catch (err) {
    const msg = errorMessage(err);
    setFailed(`google-github-actions/ssh-compute failed with: ${msg}`);
  } finally {
    restoreEnv();
  }
}

/**
 * computeGcloudVersion computes the appropriate gcloud version for the given
 * string.
 */
async function computeGcloudVersion(str: string): Promise<string> {
  str = (str || '').trim();
  if (str === '' || str === 'latest') {
    return await getLatestGcloudSDKVersion();
  }
  return str;
}

if (require.main === module) {
  run();
}
