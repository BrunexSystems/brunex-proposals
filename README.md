# Brunex secure proposal viewer

This public repository contains only the client-facing proposal viewer. Proposal data is compressed and encrypted in the URL fragment with AES-256-GCM using a password-derived key. Passwords, unencrypted client information, internal pricing controls, and proposal records are not committed to this repository.

The viewer is deployed through GitHub Pages. Secure links are created by the private Brunex Proposal Studio application.
