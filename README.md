# ssh-compute

Compute SSH Github Action aims to provide an easy way to connect to GCP instances
via ssh and execute user’s commands.

You should enable IAP TCP forwarding to establish an encrypted tunnel over which you can forward SSH connections to the VM.

Note, this action does not work when connecting to Windows VMs.
Please, check [this guide](https://cloud.google.com/compute/docs/instances/connecting-to-windows) to know more how to connect to a Windows instance.

**This is not an officially supported Google product, and it is not covered by a
Google Cloud support contract. To report bugs or request features in a Google
Cloud product, please contact [Google Cloud
support](https://cloud.google.com/support).**

## Prerequisites

This action requires:

- [Enable the Cloud Identity-Aware Proxy API](https://cloud.google.com/iap/docs/using-tcp-forwarding)

- [Create a firewall rule](https://cloud.google.com/iap/docs/using-tcp-forwarding#create-firewall-rule) to enable connections from IAP.

- [Grant the required IAM permissions](https://cloud.google.com/iap/docs/using-tcp-forwarding#grant-permission) to enable IAP TCP forwarding.

- Generate SSH keys pair and set a private key as an input param. See [Create SSH keys](https://cloud.google.com/compute/docs/connect/create-ssh-keys) tutorial to generate keys using `ssh-keygen` tool or use [gcloud compute ssh](https://cloud.google.com/sdk/gcloud/reference/compute/ssh) command.

- Set Google Cloud credentials that are authorized ssh connection to the VM. See the [Authorization](#Authorization) section below for more information.

## Usage

```yaml
jobs:
  job_id:
    permissions:
      contents: 'read'
      id-token: 'write'

    steps:
    - uses: 'actions/checkout@v4'

    - id: 'auth'
      uses: 'google-github-actions/auth@v1'
      with:
        workload_identity_provider: 'projects/123456789/locations/global/workloadIdentityPools/my-pool/providers/my-provider'
        service_account: 'my-service-account@my-project.iam.gserviceaccount.com'

    - id: 'compute-ssh'
      uses: 'google-github-actions/ssh-compute@v0'
      with:
        instance_name: 'example-instance'
        zone: 'us-central1-a'
        ssh_private_key: '${{ secrets.GCP_SSH_PRIVATE_KEY }}'
        command: 'echo Hello world'

    # Example of using the output
    - id: 'test'
      run: |-
        echo '${{ steps.compute-ssh.outputs.stdout }}'
        echo '${{ steps.compute-ssh.outputs.stderr }}'
```

## Inputs

| Name          | Requirement | Default | Description |
| ------------- | ----------- | ------- | ----------- |
| `instance_name`| _required_ | | Name of the virtual machine instance to SSH into. |
| `zone`| _required_ | | Zone of the instance to connect to. |
| `user`| _optional_ | | Specifies the username with which to SSH. If omitted, the user login name is used. If using OS Login, USER will be replaced by the OS Login user. |
| `ssh_private_key`| _required_ | | SSH private key with which to SSH. |
| `ssh_keys_dir`| _optional_ | Random directory in the temp folder | Path for a directory to store ssh keys. |
| `container`| _optional_ | | The name or ID of a container inside of the virtual machine instance to connect to. This only applies to virtual machines that are using a Google Container-Optimized virtual machine image. |
| `ssh_args`| _optional_ | | Additional flags to be passed to ssh tool. Example: '-vvv -L 80:%INSTANCE%:80'. |
| `command`| _optional_ | | A command to run on the virtual machine. Action runs the command on the target instance and then exits. You must specify at least command or script, specifying both command and script is invalid. |
| `script`| _optional_ | | A script file to run on the virtual machine. Action runs the script on the target instance and then exits. You must specify at least command or script, specifying both command and script is invalid. |
| `project_id`| _optional_ | | The GCP project ID. Overrides project ID set by credentials. |
| `flags`| _optional_ | | Space separated list of other compute ssh flags, examples can be found: https://cloud.google.com/sdk/gcloud/reference/compute/ssh/#FLAGS. Ex  --ssh-key-expiration=2017-08-29T18:52:51.142Z. |
| `gcloud_version`| _optional_ | | Version of the Cloud SDK to install. If unspecified or set to "latest", the latest available gcloud SDK version for the target platform will be installed. Example: "290.0.1". |

## Outputs

- `stdout`: Stdout from ssh command.
- `stderr`: Stderr from ssh command.

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
    - uses: 'actions/checkout@v4'

    - id: 'auth'
      uses: 'google-github-actions/auth@v1'
      with:
        workload_identity_provider: 'projects/123456789/locations/global/workloadIdentityPools/my-pool/providers/my-provider'
        service_account: 'my-service-account@my-project.iam.gserviceaccount.com'

    - id: 'compute-ssh'
      uses: 'google-github-actions/ssh-compute@v0'
      with:
        instance_name: 'example-instance'
        zone: 'us-central1-a'
        ssh_private_key: '${{ secrets.GCP_SSH_PRIVATE_KEY }}'
        command: 'echo Hello world'
```

#### Authenticating via Service Account Key JSON

```yaml
jobs:
  job_id:
    steps:
    - uses: 'actions/checkout@v4'

    - id: 'auth'
      uses: 'google-github-actions/auth@v1'
      with:
        credentials_json: '${{ secrets.gcp_credentials }}'

    - id: 'compute-ssh'
      uses: 'google-github-actions/ssh-compute@v0'
      with:
        instance_name: 'example-instance'
        zone: 'us-central1-a'
        ssh_private_key: '${{ secrets.GCP_SSH_PRIVATE_KEY }}'
        command: 'echo Hello world'
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
    - uses: 'actions/checkout@v4'

    - id: 'compute-ssh'
      uses: 'google-github-actions/ssh-compute@v0'
      with:
        instance_name: 'example-instance'
        zone: 'us-central1-a'
        ssh_private_key: '${{ secrets.GCP_SSH_PRIVATE_KEY }}'
        command: 'echo Hello world'
```
