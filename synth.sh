#!/bin/bash

yosys -p "hierarchy; proc; fsm; memory -nomap" -o "output.json" $1

