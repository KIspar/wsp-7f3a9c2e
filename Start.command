#!/bin/sh
cd -- "$(dirname -- "$0")" || exit 1
sh ./run.sh
result=$?
if [ "$result" -ne 0 ]; then
  printf '\n%s\n' '启动失败，请保留上方错误信息。按回车键关闭此窗口。'
  read -r answer
fi
exit "$result"
