import 'mocha';
import * as sinon from 'sinon';
import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as setupGcloud from '@google-github-actions/setup-cloud-sdk';
import { expect } from 'chai';
import { run } from '../../src/main';
import { run as postRun } from '../../src/post';
import { EOL } from 'os';

import { promises as fs } from 'fs';

const ERROR_PREFIX = 'google-github-actions/ssh-compute failed with:';

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
  describe('#run', function () {
    beforeEach(async function () {
      this.stubs = {
        getInput: sinon.stub(core, 'getInput').callsFake(getInputMock),
        getBooleanInput: sinon.stub(core, 'getBooleanInput').returns(false),
        exportVariable: sinon.stub(core, 'exportVariable'),
        setFailed: sinon.stub(core, 'setFailed'),
        installGcloudSDK: sinon.stub(setupGcloud, 'installGcloudSDK'),
        authenticateGcloudSDK: sinon.stub(setupGcloud, 'authenticateGcloudSDK'),
        isAuthenticated: sinon.stub(setupGcloud, 'isAuthenticated').resolves(true),
        isInstalled: sinon.stub(setupGcloud, 'isInstalled').returns(false),
        parseServiceAccountKey: sinon.stub(setupGcloud, 'parseServiceAccountKey'),
        isProjectIdSet: sinon.stub(setupGcloud, 'isProjectIdSet').resolves(true),
        installComponent: sinon.stub(setupGcloud, 'installComponent'),
        getExecOutput: sinon.stub(exec, 'getExecOutput'),
        writeFile: sinon.stub(fs, 'writeFile'),
        mkdir: sinon.stub(fs, 'mkdir'),
      };
    });

    afterEach(function () {
      Object.keys(this.stubs).forEach((k) => this.stubs[k].restore());
    });

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

    it('throws error with invalid gcloud component flag', async function () {
      this.stubs.getInput.withArgs('gcloud_component').returns('wrong_value');
      await run();
      expect(
        this.stubs.setFailed.withArgs(
          `${ERROR_PREFIX} invalid input received for gcloud_component: wrong_value`,
        ).callCount,
      ).to.be.at.least(1);
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
      await run();
      expect(
        this.stubs.setFailed.withArgs(
          `${ERROR_PREFIX} either \`command\` or \`script\` should be set`,
        ).callCount,
      ).to.be.at.least(1);
    });

    it('throws an error if neither script nor command is set', async function () {
      this.stubs.getInput.withArgs('command').returns(undefined);
      await run();
      expect(
        this.stubs.setFailed.withArgs(
          `${ERROR_PREFIX} either \`command\` or \`script\` should be set`,
        ).callCount,
      ).to.be.at.least(1);
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
      const call = this.stubs.exportVariable.getCall(1);
      expect(call.args[1]).to.be.equal('temp-dir');
    });

    it('sets a random filepath if dir not set', async function () {
      await run();
      const call = this.stubs.exportVariable.getCall(1);
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
      this.stubs.getInput.withArgs('command').returns(undefined);
      this.stubs.getInput.withArgs('script').returns('script-examples/script.sh');
      await run();
      const call = this.stubs.getExecOutput.getCall(0);
      expect(call).to.be;
      const args = call.args[1];
      expect(args).to.include.members([`bash -c \"echo 1${EOL}echo 2${EOL}echo 3\"`]);
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

  describe('#post run', function () {
    beforeEach(async function () {
      this.stubs = {
        processEnv: sinon.stub(process, 'env'),
        info: sinon.stub(core, 'info'),
        rm: sinon.stub(fs, 'rm'),
      };
    });

    afterEach(function () {
      Object.keys(this.stubs).forEach((k) => this.stubs[k].restore());
    });

    it('does not delete the file if env is not set', async function () {
      await postRun();
      expect(this.stubs.info.withArgs('Skipping ssh keys directory cleanup').callCount).to.eq(1);
      expect(this.stubs.rm.callCount).to.eq(0);
    });

    it('deletes the file if env is set in the run function', async function () {
      await run();
      await postRun();
      expect(this.stubs.rm.callCount).to.eq(1);
    });
  });
});
