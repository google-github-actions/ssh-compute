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

import { mock, test } from 'node:test';
import assert from 'node:assert';

import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as setupGcloud from '@google-github-actions/setup-cloud-sdk';
import { TestToolCache } from '@google-github-actions/setup-cloud-sdk';

import { assertMembers } from '@google-github-actions/actions-utils';

import { run } from '../../src/main';
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
  ssh_private_key: TEST_SSH_PRIVATE_KEY,
  command: 'echo Hello world',
};

const defaultMocks = (
  m: typeof mock,
  overrideInputs?: Record<string, string>,
): Record<string, any> => {
  const inputs = Object.assign({}, fakeInputs, overrideInputs);
  return {
    setFailed: m.method(core, 'setFailed', (msg: string) => {
      throw new Error(msg);
    }),
    getBooleanInput: m.method(core, 'getBooleanInput', (name: string) => {
      return !!inputs[name];
    }),
    getMultilineInput: m.method(core, 'getMultilineInput', (name: string) => {
      return inputs[name];
    }),
    getInput: m.method(core, 'getInput', (name: string) => {
      return inputs[name];
    }),
    getExecOutput: m.method(exec, 'getExecOutput', () => {
      return { exitCode: 0, stderr: '', stdout: '{}' };
    }),

    authenticateGcloudSDK: m.method(setupGcloud, 'authenticateGcloudSDK', () => {}),
    isAuthenticated: m.method(setupGcloud, 'isAuthenticated', () => {}),
    isInstalled: m.method(setupGcloud, 'isInstalled', () => {
      return true;
    }),
    installGcloudSDK: m.method(setupGcloud, 'installGcloudSDK', async () => {
      return '1.2.3';
    }),
    installComponent: m.method(setupGcloud, 'installComponent', () => {}),
    setProject: m.method(setupGcloud, 'setProject', () => {}),
    getLatestGcloudSDKVersion: m.method(setupGcloud, 'getLatestGcloudSDKVersion', () => {
      return '1.2.3';
    }),

    mkdir: m.method(fs, 'mkdir', (a: string) => {
      return a;
    }),
    writeFile: m.method(fs, 'writeFile', (a: string) => {
      return a;
    }),
  };
};

test('#run', { concurrency: true }, async (suite) => {
  const originalEnv = Object.assign({}, process.env);

  suite.before(async () => {
    suite.mock.method(core, 'debug', () => {});
    suite.mock.method(core, 'info', () => {});
    suite.mock.method(core, 'warning', () => {});
    suite.mock.method(core, 'setOutput', () => {});
    suite.mock.method(core, 'setSecret', () => {});
    suite.mock.method(core, 'group', () => {});
    suite.mock.method(core, 'startGroup', () => {});
    suite.mock.method(core, 'endGroup', () => {});
    suite.mock.method(core, 'addPath', () => {});
    suite.mock.method(core, 'exportVariable', () => {});
  });

  suite.beforeEach(async () => {
    await TestToolCache.start();
  });

  suite.afterEach(async () => {
    process.env = originalEnv;
    await TestToolCache.stop();
  });

  await suite.test('sets the project ID if provided', async (t) => {
    const mocks = defaultMocks(t.mock, {
      project_id: 'my-test-project',
    });
    await run();

    const args = mocks.getExecOutput.mock.calls?.at(0).arguments?.at(1);
    assertMembers(args, ['--project', 'my-test-project']);
  });

  await suite.test('installs the gcloud SDK if it is not already installed', async (t) => {
    const mocks = defaultMocks(t.mock);
    t.mock.method(setupGcloud, 'isInstalled', () => {
      return false;
    });

    await run();

    assert.deepStrictEqual(mocks.installGcloudSDK.mock.callCount(), 1);
  });

  await suite.test('uses the cached gcloud SDK if it was already installed', async (t) => {
    const mocks = defaultMocks(t.mock);
    t.mock.method(setupGcloud, 'isInstalled', () => {
      return true;
    });

    await run();

    assert.deepStrictEqual(mocks.installGcloudSDK.mock.callCount(), 0);
  });

  await suite.test('uses default components without gcloud_component flag', async (t) => {
    const mocks = defaultMocks(t.mock);

    await run();

    assert.deepStrictEqual(mocks.installComponent.mock.callCount(), 0);
  });

  await suite.test('installs alpha component with alpha flag', async (t) => {
    const mocks = defaultMocks(t.mock, {
      gcloud_component: 'alpha',
    });

    await run();

    const args = mocks.installComponent.mock.calls?.at(0).arguments?.at(0);
    assert.deepStrictEqual(args, 'alpha');
  });

  await suite.test('installs alpha component with beta flag', async (t) => {
    const mocks = defaultMocks(t.mock, {
      gcloud_component: 'beta',
    });

    await run();

    const args = mocks.installComponent.mock.calls?.at(0).arguments?.at(0);
    assert.deepStrictEqual(args, 'beta');
  });

  await suite.test('throws error with invalid gcloud component flag', async (t) => {
    defaultMocks(t.mock, {
      gcloud_component: 'wrong_value',
    });

    assert.rejects(
      async () => {
        await run();
      },
      { message: /invalid input received for gcloud_component: wrong_value/ },
    );
  });

  await suite.test('throws an error if both script and command are provided', async (t) => {
    defaultMocks(t.mock, {
      command: 'test command',
      script: 'test script',
    });

    assert.rejects(async () => {
      await run();
    }, /either `command` or `script` should be set/);
  });

  await suite.test('throws an error if neither script nor command is set', async (t) => {
    defaultMocks(t.mock, {
      command: '',
      script: '',
    });

    assert.rejects(async () => {
      await run();
    }, /either `command` or `script` should be set/);
  });

  await suite.test('sets the correct instance name if user is provided', async (t) => {
    const mocks = defaultMocks(t.mock, {
      user: 'testuser',
    });

    await run();

    const args = mocks.getExecOutput.mock.calls?.at(0).arguments?.at(1);
    assertMembers(args, ['testuser@hello-world-instance']);
  });

  await suite.test('sets the container if provided', async (t) => {
    const mocks = defaultMocks(t.mock, {
      container: 'my-test-container',
    });

    await run();

    const args = mocks.getExecOutput.mock.calls?.at(0).arguments?.at(1);
    assertMembers(args, ['--container', 'my-test-container']);
  });

  await suite.test('sets the temp var dir to env if provided', async (t) => {
    const mocks = defaultMocks(t.mock, {
      ssh_keys_dir: 'temp-dir',
    });

    await run();

    const args = mocks.getExecOutput.mock.calls?.at(0).arguments?.at(1);
    assertMembers(args, ['temp-dir/google_compute_engine']);

    const mkdirArgs = mocks.mkdir.mock.calls?.at(0).arguments?.at(0);
    assertMembers([mkdirArgs], ['temp-dir']);

    const writeFileArgs = mocks.writeFile.mock.calls?.map((c: { arguments: string[] }) =>
      c.arguments?.at(0),
    );
    assertMembers(writeFileArgs, [
      'temp-dir/google_compute_engine',
      'temp-dir/google_compute_engine.pub',
    ]);
  });

  await suite.test('sets a random filepath if dir not set', async (t) => {
    const mocks = defaultMocks(t.mock);

    await run();

    const args = mocks.getExecOutput.mock.calls?.at(0).arguments?.at(1);
    assert.ok(args);
  });

  await suite.test('sets the correct command if script is provided', async (t) => {
    const mocks = defaultMocks(t.mock, {
      script: 'script-examples/script.sh',
      command: '',
    });

    await run();

    const args = mocks.getExecOutput.mock.calls?.at(0).arguments?.at(1);
    assertMembers(args, [`bash -c "echo -n 1${EOL}echo -n 2${EOL}echo 3${EOL}"`]);
  });

  await suite.test('sets the correct ssh args if provided', async (t) => {
    const mocks = defaultMocks(t.mock, {
      ssh_args: '-vvv -L 80:%INSTANCE%:80',
    });

    await run();

    const args = mocks.getExecOutput.mock.calls?.at(0).arguments?.at(1);
    assertMembers(args, [`-- -vvv -L 80:%INSTANCE%:80`]);
  });
});
