<!--
Copyright 2022 Google LLC

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
-->
# ssh-compute

Compute SSH Github Action aims to provide an easy way to connect to GCP instances
via ssh and execute user’s commands.

You should enable IAP TCP forwarding to establish an encrypted tunnel over which you can forward SSH connections to the VM.

Note, this action does not work when connecting to Windows VMs. 
Please, check [this guide](https://cloud.google.com/compute/docs/instances/connecting-to-windows) to know more how to connect to a Windows instance.

## Prerequisites

This action requires:

- [Enable the Cloud Identity-Aware Proxy API](https://cloud.google.com/iap/docs/using-tcp-forwarding)

- [Create a firewall rule](https://cloud.google.com/iap/docs/using-tcp-forwarding#create-firewall-rule) to enable connections from IAP.

- [Grant the required IAM permissions](https://cloud.google.com/iap/docs/using-tcp-forwarding#grant-permission) to enable IAP TCP forwarding.

- Set Google Cloud credentials that are authorized ssh connection to the VM. See the Authorization section below for more information.

## Usage

```yaml
jobs:
  job_id:
    permissions:
      contents: 'read'
      id-token: 'write'

    steps:
    - uses: actions/checkout@v2

    - id: auth
      uses: google-github-actions/auth@v0
      with:
        workload_identity_provider: 'projects/123456789/locations/global/workloadIdentityPools/my-pool/providers/my-provider'
        service_account: 'my-service-account@my-project.iam.gserviceaccount.com'

    - id: 'compute-ssh'
      uses: 'google-github-actions/ssh-compute@v0'
      with:
        instance_name: example-instance
        zone: us-central1-a
        ssh_public_key: ${{ secrets.GCP_SSH_PUBLIC_KEY }}
        ssh_private_key: ${{ secrets.GCP_SSH_PRIVATE_KEY }}
        command: echo Hello world

    # Example of using the output
    - id: 'test'
      run: |-
        echo '${{ steps.compute-ssh.outputs.stdout }}'
        echo '${{ steps.compute-ssh.outputs.stderr }}'
```

## Authorization

### Via google-github-actions/auth

Use [google-github-actions/auth](https://github.com/google-github-actions/auth) to authenticate the action. You can use [Workload Identity Federation][wif] or traditional [Service Account Key JSON][sa] authentication.
This Action supports both the recommended [Workload Identity Federation][wif] based authentication and the traditional [Service Account Key JSON][sa] based auth.

See [usage](https://github.com/google-github-actions/auth#usage) for more details.

#### Authenticating via Workload Identity Federation

```yaml
jobs:
  job_id:
    permissions:
      contents: 'read'
      id-token: 'write'

    steps:
    - uses: 'actions/checkout@v2'

    - id: 'auth'
      uses: 'google-github-actions/auth@v0'
      with:
        workload_identity_provider: 'projects/123456789/locations/global/workloadIdentityPools/my-pool/providers/my-provider'
        service_account: 'my-service-account@my-project.iam.gserviceaccount.com'

    - id: 'compute-ssh'
      uses: 'google-github-actions/ssh-compute@v0'
      with:
        instance_name: example-instance
        zone: us-central1-a
        ssh_public_key: ${{ secrets.GCP_SSH_PUBLIC_KEY }}
        ssh_private_key: ${{ secrets.GCP_SSH_PRIVATE_KEY }}
        command: echo Hello world
```

#### Authenticating via Service Account Key JSON

```yaml
jobs:
  job_id:
    steps:
    - uses: 'actions/checkout@v2'

    - id: 'auth'
      uses: 'google-github-actions/auth@v0'
      with:
        credentials_json: '${{ secrets.gcp_credentials }}'

    - id: 'compute-ssh'
      uses: 'google-github-actions/ssh-compute@v0'
      with:
        instance_name: example-instance
        zone: us-central1-a
        ssh_public_key: ${{ secrets.GCP_SSH_PUBLIC_KEY }}
        ssh_private_key: ${{ secrets.GCP_SSH_PRIVATE_KEY }}
        command: echo Hello world
```

### Via Application Default Credentials

If you are hosting your own runners, **and** those runners are on Google Cloud,
you can leverage the Application Default Credentials of the instance. This will
authenticate requests as the service account attached to the instance. **This
only works using a custom runner hosted on GCP.**

```yaml
jobs:
  job_id:
    steps:
    - uses: 'actions/checkout@v2'

    - id: 'compute-ssh'
      uses: 'google-github-actions/ssh-compute@v0'
      with:
        instance_name: example-instance
        zone: us-central1-a
        ssh_public_key: ${{ secrets.GCP_SSH_PUBLIC_KEY }}
        ssh_private_key: ${{ secrets.GCP_SSH_PRIVATE_KEY }}
        command: echo Hello world
```
