#!/bin/bash
#
# Set a number of environmental variables and locale-related settings needed
# for this recognizer to run as expected before calling the recognizer itself.
#
export LC_ALL="en_US.UTF-8"
export PYTHONIOENCODING="utf-8"

# Activate the virtual environment, then execute the main script.
source ./venv-omni/bin/activate
exec python3 ./omni-elan.py