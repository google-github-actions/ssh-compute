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

import { promises as fs } from 'fs';

import { info as logInfo } from '@actions/core';
import { errorMessage } from '@google-github-actions/actions-utils';

import { GOOGLE_SSH_KEYS_TEMP_DIR_VAR } from './const';

/**
 * Executes the post action, documented inline.
 */
export async function run(): Promise<void> {
  try {
    // We should remove temp directory with ssh keys
    const ssh_keys_dir = process.env[GOOGLE_SSH_KEYS_TEMP_DIR_VAR];
    if (!ssh_keys_dir) {
      logInfo('Skipping ssh keys directory cleanup');
      return;
    }
    await fs.rm(ssh_keys_dir, { recursive: true, force: true });
    delete process.env[GOOGLE_SSH_KEYS_TEMP_DIR_VAR];
  } catch (err) {
    const msg = errorMessage(err);
    logInfo(`google-github-actions/ssh-compute post failed with: ${msg}`);
  }
}

run();
