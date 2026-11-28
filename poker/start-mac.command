#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  Node.js 가 필요합니다."
  echo "  https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행하세요."
  echo ""
  open https://nodejs.org
  read -n 1 -s -r -p "  아무 키나 누르면 닫힙니다…"
  exit 1
fi
node server.js
