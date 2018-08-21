#!/bin/bash

for X in tests/*.sv; do
    echo $X
    ./process.js $X > /dev/null || exit 1
done
