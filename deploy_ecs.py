import os
import sys
import tarfile
import time
import paramiko

LOG_FILE = '/Users/qiyu/视频软件/deploy.log'

def log(msg):
    with open(LOG_FILE, 'a', encoding='utf-8') as f:
        f.write(f"{msg}\n")
    print(msg)
    sys.stdout.flush()

def main():
    open(LOG_FILE, 'w').close()  # clear log
    
    # ========== Step 1: Pack ==========
    log("===== Step 1: Packing deploy archive =====")
    src_dir = '/Users/qiyu/视频软件/server'
    tar_path = '/Users/qiyu/视频软件/server-deploy.tar.gz'
    
    exclude_dirs = {'node_modules', '.git', 'src'}
    
    def filter_func(tarinfo):
        rel_path = os.path.relpath(tarinfo.name, src_dir)
        parts = rel_path.split(os.sep)
        for part in parts:
            if part in exclude_dirs:
                return None
        if len(parts) >= 2 and parts[0] == 'admin':
            if parts[1] in ('node_modules', 'src'):
                return None
        return tarinfo
    
    with tarfile.open(tar_path, 'w:gz') as tar:
        tar.add(src_dir, arcname='server', filter=filter_func)
    
    size = os.path.getsize(tar_path)
    log(f"Created: {tar_path}")
    log(f"Size: {size} bytes")
    
    # ========== Step 2: Connect & Upload ==========
    log("\n===== Step 2: Connect to ECS =====")
    host = '8.147.65.80'
    port = 22
    username = 'root'
    password = '67601263aA'
    
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(host, port=port, username=username, password=password, timeout=30)
    log(f"Connected to {host}")
    
    log("\n===== Step 3: SFTP Upload =====")
    sftp = client.open_sftp()
    remote_path = '/opt/server-deploy.tar.gz'
    sftp.put(tar_path, remote_path)
    log(f"Uploaded to {remote_path}")
    sftp.close()
    
    # ========== Step 3: Deploy ==========
    def exec_cmd(cmd_desc, cmd):
        log(f"\n>>> {cmd_desc}")
        log(f"Command: {cmd}")
        stdin, stdout, stderr = client.exec_command(cmd, get_pty=True)
        exit_status = stdout.channel.recv_exit_status()
        out = stdout.read().decode('utf-8', errors='replace')
        err = stderr.read().decode('utf-8', errors='replace')
        if out.strip():
            log(f"STDOUT:\n{out}")
        if err.strip():
            log(f"STDERR:\n{err}")
        log(f"Exit status: {exit_status}")
        return exit_status, out, err
    
    # Extract tar
    exec_cmd("Extract tar archive", "cd /opt && tar xzf server-deploy.tar.gz")
    
    # Ensure target directory exists, then copy
    exec_cmd("Copy to video-server", "mkdir -p /opt/video-server && cp -rf /opt/server/* /opt/video-server/ && rm -rf /opt/server")
    
    # Install dependencies
    exec_cmd("Install dependencies", "source ~/.nvm/nvm.sh && cd /opt/video-server && npm install 2>&1 | tail -5")
    
    # Restart PM2
    exec_cmd("Restart PM2 service", "source ~/.nvm/nvm.sh && cd /opt/video-server && pm2 restart video-server && pm2 save")
    
    # ========== Step 4: Health Check ==========
    log("\n===== Step 4: Health Check (waiting 3s) =====")
    time.sleep(3)
    
    stdin, stdout, stderr = client.exec_command("curl -s http://localhost:3000/api/health", get_pty=True)
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    log(f"Health check response: {out.strip()}")
    if err.strip():
        log(f"Health check stderr: {err.strip()}")
    
    client.close()
    log("\n===== Deployment Complete =====")

if __name__ == '__main__':
    main()
