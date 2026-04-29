import os
import tarfile
import sys

src_dir = '/Users/qiyu/视频软件/server'
output_path = '/Users/qiyu/视频软件/server-deploy.tar.gz'

print(f"Packing {src_dir} into {output_path}...")
print(f"Current working dir: {os.getcwd()}")

exclude_dirs = {'node_modules', '.git', 'src'}

def filter_func(tarinfo):
    # Get relative path from src_dir
    rel_path = os.path.relpath(tarinfo.name, src_dir)
    parts = rel_path.split(os.sep)
    
    # Skip excluded directories at any level
    for part in parts:
        if part in exclude_dirs:
            return None
    
    # Skip admin/node_modules and admin/src
    if len(parts) >= 2 and parts[0] == 'admin':
        if parts[1] in ('node_modules', 'src'):
            return None
    
    return tarinfo

with tarfile.open(output_path, 'w:gz') as tar:
    tar.add(src_dir, arcname='server', filter=filter_func)

size = os.path.getsize(output_path)
print(f"Created: {output_path}")
print(f"Size: {size} bytes")
