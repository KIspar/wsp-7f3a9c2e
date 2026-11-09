#!/bin/sh
cd -- "$(dirname -- "$0")" || exit 1
chmod u+x ./*.command ./*.sh
result=$?
if [ "$result" -eq 0 ]; then printf '%s\n' '启动文件权限已修复，请双击 Mac-启动.command。'; fi
printf '%s\n' '按回车键关闭此窗口。'
read -r answer
exit "$result"
