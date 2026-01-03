#!/bin/bash

for X in tests/*.sv tests/*.il; do
    echo $X
    ./process.js $X > /dev/null || exit 1
done
