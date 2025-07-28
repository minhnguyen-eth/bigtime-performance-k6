#!/bin/bash
export $(grep -v '^#' .env | xargs)
k6 run tests/login-test.js
