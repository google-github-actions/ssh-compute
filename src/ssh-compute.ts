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

import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as toolCache from '@actions/tool-cache';
import * as setupGcloud from '@google-github-actions/setup-cloud-sdk';

import path from 'path';
import { promises as fs } from 'fs';

import { SSH_PUBLIC_KEY_FILENAME, SSH_PRIVATE_KEY_FILENAME } from './const';

export const GCLOUD_METRICS_ENV_VAR = 'CLOUDSDK_METRICS_ENVIRONMENT';
export const GCLOUD_METRICS_LABEL = 'github-actions-ssh-compute';

export function parseFlags(flags: string): RegExpMatchArray {
  return flags.match(/(".*?"|[^"\s=]+)+(?=\s*|\s*$)/g)!; // Split on space or "=" if not in quotes
}

/**
 * Executes the main action. It includes the main business logic and is the
 * primary entry point. It is documented inline.
 */
export async function run(): Promise<void> {
  core.exportVariable(GCLOUD_METRICS_ENV_VAR, GCLOUD_METRICS_LABEL);
  try {
    // Get inputs
    // Core inputs
    let instanceName = core.getInput('instance_name');
    const zone = core.getInput('zone');
    const user = core.getInput('user');
    const ssh_public_key = core.getInput('ssh_public_key');
    const ssh_private_key = core.getInput('ssh_private_key');
    const ssh_keys_folder = core.getInput('ssh_keys_folder');
    const container = core.getInput('container');
    const sshArgs = core.getInput('ssh_args');
    let command = core.getInput('command');
    const script = core.getInput('script');
    const projectId = core.getInput('project_id');
    let gcloudVersion = core.getInput('gcloud_version');

    // Flags
    const flags = core.getInput('flags');
    const installBeta = true; // Flag for installing gcloud beta components
    let cmd;

    if (command && script) {
      throw new Error('Both `command` and `entrypoint` inputs set - Please select one.');
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
      `${ssh_keys_folder}/${SSH_PRIVATE_KEY_FILENAME}`,
      '--quiet', // we need to ignore prompts from console
      '--tunnel-through-iap',
    ];

    // Save public and private ssh keys to the temp folder
    await fs.mkdir(ssh_keys_folder, { recursive: true });
    await fs.writeFile(`${ssh_keys_folder}/${SSH_PUBLIC_KEY_FILENAME}`, ssh_public_key, {
      mode: 0o600,
    });
    await fs.writeFile(`${ssh_keys_folder}/${SSH_PRIVATE_KEY_FILENAME}`, '', { mode: 0o600 });
    for (const key of ssh_private_key.split(/(?=-----BEGIN)/)) {
      await fs.appendFile(`${ssh_keys_folder}/${SSH_PRIVATE_KEY_FILENAME}`, key.trim() + '\n');
    }

    if (container) {
      cmd.push('--container', container);
    }

    if (flags) {
      const flagList = parseFlags(flags);
      if (flagList) cmd = cmd.concat(flagList);
    }

    if (script) {
      try {
        await fs.access(script);
      } catch (error: any) {
        const message = 'Script can not be found. Check script input path.';
        throw new Error(message);
      }

      const commandData = (await fs.readFile(script)).toString('utf8');
      command = `bash -c \"${commandData}\"`; // eslint-disable-line no-useless-escape
    }

    if (sshArgs) {
      cmd.push(`-- ${sshArgs}`);
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
    if (projectId) {
      await setupGcloud.setProject(projectId);
    } else if (process.env.GCLOUD_PROJECT) {
      await setupGcloud.setProject(process.env.GCLOUD_PROJECT);
    }
    // Fail if no Project Id is provided if not already set.
    const projectIdSet = await setupGcloud.isProjectIdSet();
    if (!projectIdSet) {
      throw new Error('No project Id provided.');
    }

    // Install beta components if needed and prepend the beta command
    if (installBeta) {
      await setupGcloud.installComponent('beta');
      cmd.unshift('beta');
    }

    const toolCommand = setupGcloud.getToolCommand();

    // Get output of gcloud cmd.
    let output = '';
    const stdout = (data: Buffer): void => {
      output += data.toString();
    };
    let errOutput = '';
    const stderr = (data: Buffer): void => {
      errOutput += data.toString();
    };

    const options = {
      listeners: {
        stderr,
        stdout,
      },
      silent: true,
    };

    try {
      cmd = [...cmd, '--command', command];
      await exec.exec(toolCommand, cmd, options);

      core.setOutput('stdout', output);
      core.setOutput('stderr', errOutput);
    } catch (error: any) {
      if (errOutput) {
        throw new Error(errOutput);
      } else {
        throw new Error(error);
      }
    }
  } catch (error: any) {
    core.setFailed(error);
  }
}
