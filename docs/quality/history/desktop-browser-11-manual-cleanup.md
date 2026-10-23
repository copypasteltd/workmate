# 浏览器尝试 11 的异常回收 / Attempt 11 exceptional cleanup

浏览器尝试 11 因弹窗 guest WebContents 绑定错误出现 Electron 错误窗口，未生成正常的旅程结果。原始报告 `dev/copypaste-delivery/evidence/desktop-browser-11.json` 保留失败及缺失 result.json 的事实；本记录不补造正常退出证明。

当时检查进程路径与命令行后，仅对本次验证拥有的 Electron PID 39520 及其子进程执行 `taskkill.exe /PID 39520 /T /F`。其父 PID 为 27484，可执行文件位于 Desktop 仓库的 `node_modules/electron/dist/electron.exe`，命令为本次 `check-native-browser.cjs`。测试目录为 `65e7973f-241f-456a-93a6-2bac365be99d`。这属于异常强制回收，不能记为正常关闭；未将该尝试用于当前通过计数。

This records an exceptional, ownership-checked termination from the execution notes, not a reconstructed successful journey. Attempt 11 retained its original failed report and missing-result error. Only the owned Electron process tree, PID 39520 under parent 27484, was terminated after checking its repository executable and test command. It does not establish graceful shutdown. Selected later passing evidence must independently prove its own resource cleanup.
