#!/bin/bash
cd "$(dirname "$0")"
exec node index.js >> /tmp/claude-matrix-bridge.log 2>&1
