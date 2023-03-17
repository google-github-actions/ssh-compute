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

import 'mocha';
import { expect } from 'chai';
import * as sinon from 'sinon';

import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as setupGcloud from '@google-github-actions/setup-cloud-sdk';
import { TestToolCache } from '@google-github-actions/setup-cloud-sdk';
import { errorMessage } from '@google-github-actions/actions-utils';

import { run } from '../../src/main';
import { GOOGLE_SSH_KEYS_TEMP_DIR_VAR } from '../../src/const';
import { EOL } from 'os';

import { promises as fs } from 'fs';

const TEST_SSH_PRIVATE_KEY = `-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAaAAAABNlY2RzYS
1zaGEyLW5pc3RwMjU2AAAACG5pc3RwMjU2AAAAQQR9WZPeBSvixkhjQOh9yCXXlEx5CN9M
yh94CJJ1rigf8693gc90HmahIR5oMGHwlqMoS7kKrRw+4KpxqsF7LGvxAAAAqJZtgRuWbY
EbAAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBH1Zk94FK+LGSGNA
6H3IJdeUTHkI30zKH3gIknWuKB/zr3eBz3QeZqEhHmgwYfCWoyhLuQqtHD7gqnGqwXssa/
EAAAAgBzKpRmMyXZ4jnSt3ARz0ul6R79AXAr5gQqDAmoFeEKwAAAAOYWpAYm93aWUubG9j
YWwBAg==
-----END OPENSSH PRIVATE KEY-----`;

const fakeInputs: { [key: string]: string } = {
  instance_name: 'hello-world-instance',
  zone: 'us-central1-a',
  user: '',
  ssh_private_key: TEST_SSH_PRIVATE_KEY,
  ssh_keys_dir: '',
  container: '',
  ssh_args: '',
  command: 'echo Hello world',
  project_id: '',
  gcloud_version: '',
};

function getInputMock(name: string): string {
  return fakeInputs[name];
}

describe('#ssh-compute', function () {
  beforeEach(async function () {
    await TestToolCache.start();

    this.stubs = {
      authenticateGcloudSDK: sinon.stub(setupGcloud, 'authenticateGcloudSDK'),
      exportVariable: sinon.stub(core, 'exportVariable'),
      getBooleanInput: sinon.stub(core, 'getBooleanInput').returns(false),
      getInput: sinon.stub(core, 'getInput').callsFake(getInputMock),
      getLatestGcloudSDKVersion: sinon
        .stub(setupGcloud, 'getLatestGcloudSDKVersion')
        .resolves('1.2.3'),
      getExecOutput: sinon
        .stub(exec, 'getExecOutput')
        .resolves({ exitCode: 0, stderr: '', stdout: '{}' }),
      isInstalled: sinon.stub(setupGcloud, 'isInstalled').returns(true),
      installGcloudSDK: sinon.stub(setupGcloud, 'installGcloudSDK'),
      installComponent: sinon.stub(setupGcloud, 'installComponent'),
      mkdir: sinon.stub(fs, 'mkdir'),
      processEnv: sinon.stub(process, 'env'),
      setOutput: sinon.stub(core, 'setOutput'),
      writeFile: sinon.stub(fs, 'writeFile'),
    };

    sinon.stub(core, 'addPath').callsFake(sinon.fake());
    sinon.stub(core, 'debug').callsFake(sinon.fake());
    sinon.stub(core, 'endGroup').callsFake(sinon.fake());
    sinon.stub(core, 'info').callsFake(sinon.fake());
    sinon.stub(core, 'setFailed').throwsArg(0); // make setFailed throw exceptions
    sinon.stub(core, 'startGroup').callsFake(sinon.fake());
    sinon.stub(core, 'warning').callsFake(sinon.fake());
  });

  afterEach(async function () {
    await TestToolCache.stop();
    Object.keys(this.stubs).forEach((k) => this.stubs[k].restore());
    delete process.env[GOOGLE_SSH_KEYS_TEMP_DIR_VAR];
    sinon.restore();
  });

  describe('#run', function () {
    it('sets the project ID if provided', async function () {
      this.stubs.getInput.withArgs('project_id').returns('my-test-project');
      await run();

      const call = this.stubs.getExecOutput.getCall(0);
      expect(call).to.be;
      const args = call.args[1];
      expect(args).to.include.members(['--project', 'my-test-project']);
    });

    it('installs the gcloud SDK if it is not already installed', async function () {
      this.stubs.isInstalled.returns(false);
      await run();
      expect(this.stubs.installGcloudSDK.callCount).to.eq(1);
    });

    it('uses the cached gcloud SDK if it was already installed', async function () {
      this.stubs.isInstalled.returns(true);
      await run();
      expect(this.stubs.installGcloudSDK.callCount).to.eq(0);
    });

    it('uses default components without gcloud_component flag', async function () {
      await run();
      expect(this.stubs.installComponent.callCount).to.eq(0);
    });

    it('installs alpha component with alpha flag', async function () {
      this.stubs.getInput.withArgs('gcloud_component').returns('alpha');
      await run();
      expect(this.stubs.installComponent.withArgs('alpha').callCount).to.eq(1);
    });

    it('installs beta component with beta flag', async function () {
      this.stubs.getInput.withArgs('gcloud_component').returns('beta');
      await run();
      expect(this.stubs.installComponent.withArgs('beta').callCount).to.eq(1);
    });

    it('throws an error if both script and command are provided', async function () {
      this.stubs.getInput.withArgs('script').returns('test script');
      this.stubs.getInput.withArgs('command').returns('test command');
      expectError(run, 'either `command` or `script` should be set');
    });

    it('throws an error if neither script nor command is set', async function () {
      this.stubs.getInput.withArgs('script').returns('');
      this.stubs.getInput.withArgs('command').returns('');
      expectError(run, 'either `command` or `script` should be set');
    });

    it('sets the correct instance name if user is provided', async function () {
      this.stubs.getInput.withArgs('user').returns('testuser');
      await run();

      const call = this.stubs.getExecOutput.getCall(0);
      expect(call).to.be;
      const args = call.args[1];
      expect(args).to.include.members(['testuser@hello-world-instance']);
    });

    it('sets the container if provided', async function () {
      this.stubs.getInput.withArgs('container').returns('my-test-container');
      await run();

      const call = this.stubs.getExecOutput.getCall(0);
      expect(call).to.be;
      const args = call.args[1];
      expect(args).to.include.members(['--container', 'my-test-container']);
    });

    it('sets the temp var dir to env if provided', async function () {
      this.stubs.getInput.withArgs('ssh_keys_dir').returns('temp-dir');
      await run();
      const call = this.stubs.exportVariable.getCall(0);
      expect(call.args[1]).to.be.equal('temp-dir');
    });

    it('sets a random filepath if dir not set', async function () {
      await run();
      const call = this.stubs.exportVariable.getCall(0);
      expect(call.args[1].length).to.be.gt(0);
    });

    it('creates folder for the keys', async function () {
      this.stubs.getInput.withArgs('ssh_keys_dir').returns('temp-dir');
      await run();
      expect(this.stubs.mkdir.withArgs('temp-dir').callCount).to.eq(1);
    });

    it('writes private key to the folder', async function () {
      this.stubs.getInput.withArgs('ssh_keys_dir').returns('temp-dir');
      await run();
      expect(this.stubs.writeFile.withArgs('temp-dir/google_compute_engine.pub').callCount).to.eq(
        1,
      );
    });

    it('writes public key to the folder', async function () {
      this.stubs.getInput.withArgs('ssh_keys_dir').returns('temp-dir');
      await run();
      expect(this.stubs.writeFile.withArgs('temp-dir/google_compute_engine.pub').callCount).to.eq(
        1,
      );
    });

    it('sets the correct command if script is provided', async function () {
      this.stubs.getInput.withArgs('command').returns('');
      this.stubs.getInput.withArgs('script').returns('script-examples/script.sh');
      await run();
      const call = this.stubs.getExecOutput.getCall(0);
      expect(call).to.be;
      const args = call.args[1];
      expect(args).to.include.members([`bash -c \"echo -n 1${EOL}echo -n 2${EOL}echo 3${EOL}\"`]);
    });

    it('sets the correct ssh args if provided', async function () {
      this.stubs.getInput.withArgs('ssh_args').returns('-vvv -L 80:%INSTANCE%:80');
      await run();
      const call = this.stubs.getExecOutput.getCall(0);
      expect(call).to.be;
      const args = call.args[1];
      expect(args).to.include.members(['-- -vvv -L 80:%INSTANCE%:80']);
    });
  });
});

async function expectError(fn: () => Promise<void>, want: string) {
  try {
    await fn();
    throw new Error(`expected error`);
  } catch (err) {
    const msg = errorMessage(err);
    expect(msg).to.include(want);
  }
}
