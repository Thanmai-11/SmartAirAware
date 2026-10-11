# Phase 6 runbook: deploy, test, demo, submit

## A. Local check of the frontend (Phase 5 "Done when")
1. Terminal 1: `.\scripts\run_api.ps1`   Terminal 2: `.\scripts\run_worker.ps1`
2. Terminal 3: `cd frontend; npm install; npm run dev`, then open http://localhost:5173
3. Settings: paste the admin key, upload the headcount CSV, Save headcount, Run now.
4. Wait 2 to 5 minutes. Schedule tab: table, charts, CSV download.
5. States to see once: empty (fresh DB), stale banner (internet off, then Run now), failed banner (break `ENERGYPLUS_DIR`, Run now).
6. Production check: `npm run build; npm run preview` and confirm it loads (preview uses the same proxy rules from vite.config.js).

## B. Deploy to EC2
1. Push everything to GitHub (including `frontend/package-lock.json`). The README must name the pinned EnergyPlus version.
2. On EC2 (SSH in as `ubuntu`):
   ```bash
   git clone <REPO_URL> /tmp/smartair-bootstrap && cd /tmp/smartair-bootstrap
   sudo REPO_URL=<REPO_URL> ENERGYPLUS_URL=<installer URL> bash deploy/setup.sh
   ```
   Save the printed `ADMIN_KEY`.
3. Security group: ports 80 and 443 from anywhere, port 22 from your IP only.
4. From your laptop: `.\scripts\deploy_frontend.ps1 -HostIp <ELASTIC_IP> -KeyPath <key.pem>`
5. Open `http://<ELASTIC_IP>` on your phone (mobile data, not your Wi-Fi).

## C. Smoke test, reboot test, scenarios
```bash
bash scripts/smoke_test.sh http://<ELASTIC_IP>      # after one successful run
sudo reboot                                        # wait ~1 min, SSH back in
systemctl is-active smartair-api smartair-worker nginx
bash scripts/smoke_test.sh http://<ELASTIC_IP>
sudo -u smartair bash -lc 'cd /opt/smartair && .venv/bin/pytest tests -k scenario -q'   # three frozen days
journalctl -u smartair-worker -n 100 --no-pager
```
Backup check: `sudo -u smartair /opt/smartair/scripts/backup.sh && ls /opt/smartair/backups`

## D. Recording the demo without live data
1. Edit `/opt/smartair/.env`: `FORECAST_SOURCE=fixture` and `FIXTURE_PATH=` the high-PM2.5 fixture. Then `sudo systemctl restart smartair-worker`.
2. Settings, Run now. Repeat with the clean-air and hot-day fixtures if you want to show all three.
3. Switch back to `FORECAST_SOURCE=live` after recording and restart the worker.

## E. Three-minute demo script
| Time | Show | Say |
|---|---|---|
| 0:00 | Title, then the Air theme | Offices keep cooling on bad air days and either pull in smoke or waste energy. Facility managers have no hourly plan that handles both. |
| 0:25 | Settings page | The manager sets headcount, comfort range, PM2.5 limit and peak window. Upload the headcount CSV. |
| 0:55 | Dashboard on the high-PM2.5 day | The forecast shows high outdoor PM2.5. Ventilate is avoided and the mode strip shows why. |
| 1:35 | Schedule table, then Download CSV | Each hour has a mode, setpoint, outdoor air and the action to take. The CSV can go to a building team. |
| 2:05 | Stats and the power chart | Savings versus always-Maintain, lower peak, flexible kW during the peak window. |
| 2:25 | AWS console, then the public URL | EC2 runs the API, worker and EnergyPlus. Show the running instance and Elastic IP. |
| 2:45 | Limits | Savings are simulated on a reference office. Air quality data is coarse. Output is advisory with two controls. |

## F. Blog post outline (AWS Builder Center)
1. The problem: indoor air on smoky or polluted days versus energy cost.
2. How it works in one paragraph, with the architecture diagram.
3. Why EnergyPlus plus an optimizer, and how the verify step keeps it honest.
4. Why AWS: EC2 t3.medium, Elastic IP, nginx, systemd, nightly SQLite backup.
5. What went wrong (use your real notes: Windows vs Linux paths, version updater, outdoor air multiplier cap, and so on).
6. Limits and what is next.

## G. Submission checklist
- [ ] Public URL opens from another network
- [ ] Reboot test passed, both services back
- [ ] Repo public, README lists pinned EnergyPlus version and setup steps
- [ ] `.env` and `*.db` are not in the repo
- [ ] Video under 3 minutes and uploaded
- [ ] Blog post published on AWS Builder Center
- [ ] Submit URL, repo, video, blog. Then reload the live URL once more.

Cut order if short on time: energy CSV upload, extra charts, second verify loop. Never cut the pipeline, the schedule table with CSV, or the AWS deployment.
