#!/bin/bash

# find-polluter.sh - Finds which test causes state pollution
# Usage: ./find-polluter.sh <pattern-to-find> <test-files-glob>
# Example: ./find-polluter.sh '.git' 'src/**/*.test.ts'

PATTERN=$1
TEST_FILES=$2

if [ -z "$PATTERN" ] || [ -z "$TEST_FILES" ]; then
  echo "Usage: ./find-polluter.sh <pattern-to-find> <test-files-glob>"
  exit 1
fi

echo "Searching for polluter causing: $PATTERN"
echo "Searching in: $TEST_FILES"

for file in $TEST_FILES; do
  echo -n "Running $file... "
  
  # Clean up before test
  rm -rf "$PATTERN"
  
  # Run single test
  npm test "$file" > /dev/null 2>&1
  
  # Check if pattern appeared
  if [ -e "$PATTERN" ]; then
    echo "POLLUTER FOUND!"
    echo "Test file: $file"
    exit 0
  fi
  
  echo "Clean"
done

echo "No polluter found in the specified files."
exit 1
