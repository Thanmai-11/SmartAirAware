# Run from the repo root on your Windows laptop:
#   .\scripts\deploy_frontend.ps1 -HostIp 13.x.x.x -KeyPath C:\path\to\key.pem
param(
  [Parameter(Mandatory = $true)][string]$HostIp,
  [Parameter(Mandatory = $true)][string]$KeyPath,
  [string]$User = "ubuntu"
)
$ErrorActionPreference = "Stop"

Push-Location frontend
npm ci
npm run build
Pop-Location

ssh -i $KeyPath "$User@$HostIp" "rm -rf /tmp/smartair-dist"
scp -i $KeyPath -r frontend/dist "${User}@${HostIp}:/tmp/smartair-dist"
ssh -i $KeyPath "$User@$HostIp" "sudo mkdir -p /var/www/smartair && sudo rm -rf /var/www/smartair/* && sudo cp -r /tmp/smartair-dist/* /var/www/smartair/ && rm -rf /tmp/smartair-dist && sudo nginx -t && sudo systemctl reload nginx"
Write-Host "Frontend deployed to http://$HostIp"
