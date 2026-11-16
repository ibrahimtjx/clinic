@echo off
rem Clinic Server backups and restore (run as Administrator). Examples:
rem   clinic-ops backup-now
rem   clinic-ops restore-dump clinic-20261116-0200.dump.enc
rem   clinic-ops restore-pitr base-20261113-0200.tar.enc "2026-11-16 10:45:00"
rem   clinic-ops decrypt FILE.enc FILE
rem   clinic-ops reset-password admin
"%~dp0..\python\python.exe" "%~dp0ops_win.py" %*
