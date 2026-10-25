# Security policy

## Reporting a vulnerability

Please **do not open a public issue**. Report it privately through GitHub:
**Security → Report a vulnerability** on this repository (a private security advisory). Include what you found,
how to reproduce it and what an attacker gains. You get an answer within a week; a fix and an advisory follow
once it is confirmed, with credit if you want it.

Add-ons from the marketplace: report to the add-on's own repository, or here when it lives in `bastionlab/addons`.

## Supported versions

Only the latest release of the core gets security fixes. Update from **Add-ons → Core** in the dashboard.

## What is in scope

The agent runs as root on the Proxmox host, so anything that lets someone reach it without the owner's approval
matters most: getting past the login or PIN, running an action without the confirm step, reading secrets
(`/etc/dash/secrets`, tokens, keys) from the browser, or an add-on that slips past `agent/addon_scan.py`.

Out of scope: what an owner does on purpose with root access (Claude in Auto mode, the web terminals), and
add-ons the owner installed after seeing their warning.
