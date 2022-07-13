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

import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as toolCache from '@actions/tool-cache';
import * as setupGcloud from '@google-github-actions/setup-cloud-sdk';
import {
  errorMessage,
  exactlyOneOf,
  isPinnedToHead,
  parseFlags,
  pinnedToHeadWarning,
  presence,
  randomFilepath,
} from '@google-github-actions/actions-utils';

import sshpk from 'sshpk';

import {
  SSH_PUBLIC_KEY_FILENAME,
  SSH_PRIVATE_KEY_FILENAME,
  GOOGLE_SSH_KEYS_TEMP_DIR_VAR,
} from './const';

export const GCLOUD_METRICS_ENV_VAR = 'CLOUDSDK_METRICS_ENVIRONMENT';
export const GCLOUD_METRICS_LABEL = 'github-actions-ssh-compute';

export async function run(): Promise<void> {
  try {
    core.exportVariable(GCLOUD_METRICS_ENV_VAR, GCLOUD_METRICS_LABEL);

    // Warn if pinned to HEAD
    if (isPinnedToHead()) {
      core.warning(pinnedToHeadWarning('v0'));
    }

    // Get inputs
    // Core inputs
    let instanceName = core.getInput('instance_name');
    const zone = core.getInput('zone');
    const user = core.getInput('user');
    const sshPrivateKey = core.getInput('ssh_private_key');
    const sshKeysDir = core.getInput('ssh_keys_dir') || randomFilepath();
    const container = core.getInput('container');
    const sshArgs = core.getInput('ssh_args');
    let command = core.getInput('command');
    const script = core.getInput('script');
    const projectID = core.getInput('project_id');
    let gcloudVersion = core.getInput('gcloud_version');
    const gcloudComponent = presence(core.getInput('gcloud_component'));

    core.exportVariable(GOOGLE_SSH_KEYS_TEMP_DIR_VAR, sshKeysDir);

    // Flags
    const flags = core.getInput('flags');
    let cmd;

    if (!exactlyOneOf(command, script)) {
      throw new Error('either `command` or `script` should be set');
    }

    // Validate gcloud component input
    if (gcloudComponent && gcloudComponent !== 'alpha' && gcloudComponent !== 'beta') {
      throw new Error(`invalid input received for gcloud_component: ${gcloudComponent}`);
    }

    if (user) {
      instanceName = `${user}@${instanceName}`;
    }

    cmd = [
      'compute',
      'ssh',
      instanceName,
      '--zone',
      zone,
      '--ssh-key-file',
      `${sshKeysDir}/${SSH_PRIVATE_KEY_FILENAME}`,
      '--quiet', // we need to ignore prompts from console
      '--tunnel-through-iap',
    ];

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

    if (container) {
      cmd.push('--container', container);
    }

    if (flags) {
      const flagList = parseFlags(flags.replace('\n', ' '));
      if (flagList) cmd = cmd.concat(flagList);
    }

    if (script) {
      const commandData = (await fs.readFile(script)).toString('utf8');
      command = `bash -c \"${commandData}\"`; // eslint-disable-line no-useless-escape
    }

    // Install gcloud if not already installed.
    if (!gcloudVersion || gcloudVersion == 'latest') {
      gcloudVersion = await setupGcloud.getLatestGcloudSDKVersion();
    }
    if (!setupGcloud.isInstalled(gcloudVersion)) {
      await setupGcloud.installGcloudSDK(gcloudVersion);
    } else {
      const toolPath = toolCache.find('gcloud', gcloudVersion);
      core.addPath(path.join(toolPath, 'bin'));
    }

    // Authenticate gcloud SDK.
    await setupGcloud.authenticateGcloudSDK();
    const authenticated = await setupGcloud.isAuthenticated();
    if (!authenticated) {
      throw new Error('Error authenticating the Cloud SDK.');
    }

    // set PROJECT ID
    if (projectID) cmd.push('--project', projectID);

    // Fail if no Project Id is provided if not already set.
    const projectIdSet = await setupGcloud.isProjectIdSet();
    if (!projectIdSet) {
      throw new Error('No project Id provided.');
    }

    // Install gcloud component if needed and prepend the command
    if (gcloudComponent) {
      await setupGcloud.installComponent(gcloudComponent);
      cmd.unshift(gcloudComponent);
    }

    cmd = [...cmd, '--command', command];

    if (sshArgs) {
      cmd.push(`-- ${sshArgs}`);
    }

    const toolCommand = setupGcloud.getToolCommand();
    const options = { silent: true, ignoreReturnCode: true };
    const commandString = `${toolCommand} ${cmd.join(' ')}`;
    core.info(`Running: ${commandString}`);

    const output = await exec.getExecOutput(toolCommand, cmd, options);

    core.setOutput('stdout', output.stdout);
    core.setOutput('stderr', output.stderr);

    if (output.exitCode !== 0) {
      const errMsg = output.stderr || `command exited ${output.exitCode}, but stderr had no output`;
      throw new Error(`failed to execute gcloud command \`${commandString}\`: ${errMsg}`);
    }
  } catch (err) {
    const msg = errorMessage(err);
    core.setFailed(`google-github-actions/ssh-compute failed with: ${msg}`);
  }
}

if (require.main === module) {
  run();
}
