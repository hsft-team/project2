# Windows automatic recovery

## Backend and admin web

The system installer lives in this mobile repository and manages sibling
deployments without changing backend/admin source files. Keep the mobile
scripts directory at the same location after registering the tasks.

Run in Administrator PowerShell under the Windows user who runs Docker Desktop:

```powershell
cd C:\attendance-app\mobile
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-system-autostart.ps1
```

Prerequisites: machine-wide Java 17+, Docker Desktop with existing production
images, backend/.env.prod and docker-compose.prod.yml, and the built admin JAR.
The admin runner reads INTERNAL_API_KEY from backend/.env.prod. Existing
machine-level environment variables supply other admin settings. No passwords
are written into task arguments. A custom installation can pass -BackendRoot,
-AdminRoot, and -DesktopPath to the installer.

- Attendance-Admin-Web: SYSTEM task at boot, no login needed, one-minute failure retries.
- Attendance-Backend-Recovery: interactive task for the installing Windows user
  at login. Starts Docker Desktop and reconciles postgres/app/nginx every 30 seconds.
  It waits for Docker readiness, uses .env.prod, and never builds or pulls at boot.

Docker Desktop requires a user session. Reboot recovery of backend/nginx/DB
therefore happens AFTER WINDOWS LOGIN. This installer does not configure
automatic Windows login and does not provide unattended pre-login Docker startup.
For that requirement, use a service-hosted Linux Docker Engine deployment.

Verification on the mini PC (also repeat after reboot and login):

```powershell
Get-ScheduledTask -TaskName Attendance-Admin-Web,Attendance-Backend-Recovery
Get-ScheduledTaskInfo -TaskName Attendance-Admin-Web
curl.exe -I http://localhost:8081/login
cd C:\attendance-app\backend
docker compose -f docker-compose.prod.yml --env-file .env.prod ps
```

Check backend/backend-autostart.log and admin-web/admin-web.out.log or
admin-web/admin-web.err.log if recovery fails. Repeated failure retries are
limited to 999 by Task Scheduler. Real Windows installation/reboot verification
is required; these scripts cannot be executed on the development Mac.

Before deploying admin-web with its existing build script, stop its task so it
does not restart Java while Maven replaces the JAR. Restart it in finally:

```powershell
Stop-ScheduledTask -TaskName Attendance-Admin-Web
try {
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\attendance-app\admin-web\scripts\deploy-prod.ps1
    if ($LASTEXITCODE -ne 0) { throw "Admin deployment failed." }
} finally {
    Start-ScheduledTask -TaskName Attendance-Admin-Web
}
```

Stop Attendance-Backend-Recovery before a planned Docker maintenance shutdown;
otherwise its watchdog will bring the containers back. Start it again afterwards.

## Mobile web

On the mini PC, open PowerShell as Administrator. Stop the manually started
server with Ctrl+C first. Node.js, npm dependencies, and dist/index.html must
already exist.

```powershell
cd C:\attendance-app\mobile
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-autostart.ps1
```

The Attendance-Mobile-Web scheduled task starts at boot as SYSTEM without a
user login. It serves the existing build; it does not install or build at boot.
Unexpected exits trigger a retry after one minute, up to 999 retries. Closing
PowerShell does not stop the task. Use machine-wide Node.js on a local disk,
not a per-user version manager or network drive.

Verify, then reboot the PC once to check boot recovery:

```powershell
Get-ScheduledTask -TaskName Attendance-Mobile-Web
Get-ScheduledTaskInfo -TaskName Attendance-Mobile-Web
curl.exe -I http://localhost:4173
```

Deployments use the installed task. Run as Administrator to manage that task:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\deploy-prod.ps1
```

Logs append to mobile-web.out.log and mobile-web.err.log in the project root.
For a different port, register the task again with -Port before deploying.
Docker Desktop, nginx, and the backend must also be running for the external
website and login to work. This task manages the mobile web server only.

Remove automatic startup and stop the task:

```powershell
Stop-ScheduledTask -TaskName Attendance-Mobile-Web
Unregister-ScheduledTask -TaskName Attendance-Mobile-Web -Confirm:$false
```
