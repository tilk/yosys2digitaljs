#!/bin/bash

yosys -p "hierarchy; proc; fsm; memory -nomap; pmuxtree" -o "output.json" $1

