import os
import subprocess

path = '/tmp/server-deploy.tar.gz'
print(f"Checking {path}...")
if os.path.exists(path):
    print(f'File exists: {path}')
    print(f'Size: {os.path.getsize(path)} bytes')
else:
    print(f'File NOT found: {path}')
    print('Creating tar archive...')
    os.chdir('/Users/qiyu/视频软件')
    cmd = [
        'tar', 'czf', path,
        '--exclude=node_modules', '--exclude=.git', '--exclude=src',
        '--exclude=admin/node_modules', '--exclude=admin/src',
        'server/'
    ]
    env = os.environ.copy()
    env['COPYFILE_DISABLE'] = '1'
    result = subprocess.run(cmd, capture_output=True, text=True, env=env)
    print('STDOUT:', result.stdout)
    print('STDERR:', result.stderr)
    print('Return code:', result.returncode)
    if os.path.exists(path):
        print(f'Created successfully. Size: {os.path.getsize(path)} bytes')
    else:
        print('Failed to create tar file!')
