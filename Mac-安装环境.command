#!/bin/sh
cd -- "$(dirname -- "$0")" || exit 1
sh ./run.sh --setup
result=$?
printf '\n%s\n' '处理完成。请保留上方结果，按回车键关闭此窗口。'
read -r answer
exit "$result"
