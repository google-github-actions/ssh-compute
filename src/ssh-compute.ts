/*
 * Copyright 2020 Google LLC
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

import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as toolCache from '@actions/tool-cache';
import * as setupGcloud from '@google-github-actions/setup-cloud-sdk';
import path from 'path';

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
    const container = core.getInput('container');
    const sshKeyFile = core.getInput('ssh_key_file');
    const sshKeyExpireAfter = core.getInput('ssh_key_expire_after')
    const sshArgs = core.getInput('ssh_args');
    const command = core.getInput('command');
    const credentials = core.getInput('credentials');
    let projectId = core.getInput('project_id');
    let gcloudVersion = core.getInput('gcloud_version');
  
    // Flags
    const internalIp = core.getInput('internal_ip');
    const tunnelThroughIap = core.getInput('tunnel_through_iap');
    const flags = core.getInput('flags');
    const installBeta = false; // Flag for installing gcloud beta components
    let cmd;
  
    if (internalIp && tunnelThroughIap) {
      throw new Error(
        'Both `internal_ip` and `tunnel_through_iap` inputs set - Please select one.',
      );
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
      '--quiet', // we need to ignore promts from console
    ];

    if (container) {
      cmd.push('--container', container);
    }

    if (sshKeyFile) {
      cmd.push('--ssh-key-file', sshKeyFile);
    }

    if (sshKeyExpireAfter) {
      cmd.push('--ssh-key-expire-after', sshKeyExpireAfter);
    }

    if (tunnelThroughIap) {
      cmd.push('--tunnel-through-iap');
    }

    if (internalIp) {
      cmd.push('--internal-ip');
    }

    if (flags) {
      const flagList = parseFlags(flags);
      if (flagList) cmd = cmd.concat(flagList);
    }

    if (sshArgs) {
      cmd.push('--', sshArgs);
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
    if (credentials) await setupGcloud.authenticateGcloudSDK(credentials);
    const authenticated = await setupGcloud.isAuthenticated();
    if (!authenticated) {
      throw new Error('Error authenticating the Cloud SDK.');
    }

    // set PROJECT ID
    if (projectId) {
      await setupGcloud.setProject(projectId);
    } else if (credentials) {
      projectId = await setupGcloud.setProjectWithKey(credentials);
    } else if (process.env.GCLOUD_PROJECT) {
      await setupGcloud.setProject(process.env.GCLOUD_PROJECT);
    }
    // Fail if no Project Id is provided if not already set.
    const projectIdSet = await setupGcloud.isProjectIdSet();
    if (!projectIdSet)
      throw new Error(
        'No project Id provided. Ensure you have set either the project_id or credentials fields.',
      );

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
    // Run gcloud cmd.
    try {
      if (!sshKeyFile) {
        // we should generate ssh keys first
        const doNothingCommand = [...cmd, '--command', `'exit 0'`];
        core.info(`running: ${toolCommand} ${doNothingCommand.join(' ')}`);
        await exec.exec(toolCommand, doNothingCommand, {silent: true});
      }
      cmd = [...cmd, '--command', `'${command}'`];
      core.info(`running: ${toolCommand} ${cmd.join(' ')}`);
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
