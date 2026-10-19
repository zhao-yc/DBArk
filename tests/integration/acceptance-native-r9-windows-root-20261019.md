# R9 Windows 源码与真实安装专项独立复核

本记录只对应 `95e68637915ad8a8b0ffc51fae98a64f4abd85c2`、首次运行 [39194270038](https://github.com/zhao-yc/DBArk/actions/runs/39194270038)、Windows job `117873502440`。产品源码仍是旧 `e0fa1dd`，不能沿用给后续 `65ce201` 首次文件模型变更。R9整轮失败，Linux及两个macOS失败事实保留。

Root独立下载测试记录 artifact `12162186106`，5320656字节，SHA256 `a4654c19662ecf0be2ceb6ae35f53cce2f0e52df541ff3637201a667da8f08da`；与API摘要一致，ZIP完整CRC通过。逐份读取原JSON报告、批准、accepted receipt及完成记录，四份均为准确专项单次通过、retry=0，无额外用例、跳过或全局错误。

| 阶段／专项 | 原报告SHA256 | body毫秒 | 原正常owner |
| --- | --- | ---: | ---: |
| 源码／缩进 | `30b06365987ecf9ad57c2363433a0c45132343786e65af1e0004c3761a9c5127` | 20169 | 2 |
| 源码／分栏 | `1a0689d0b062028960eba63a6a96ea6bbf92a5f9a9fb6361b05d2910aaef8c97` | 19964 | 2 |
| 安装／缩进 | `c32e00537eb10cdfeba3a6a2f1dbe0206353123e598ea0fdc4f322339a31e40b` | 16802 | 2 |
| 安装／分栏 | `b139a62d2e95e648b225da0eac3803b2b2bde4a75b618ca06d743679b3756b14` | 22535 | 2 |

八个原owner均 confirmed／willQuit／closed，PID数为有效正整数，成功目录删除；SQLite9、完整恢复及原模型／历史检查由对应专项原附件证明。accepted receipt精确绑定阶段、专项、spec、原批准SHA与原报告SHA，footer与receipt proof相同，源码／安装完成记录闭合。

源码封存113文件，安装封存119文件。安装清单含一个准确外部前检脚本：其路径和SHA绑定源码批准，其他运行文件与实际安装／pack reference对应；不能说119个文件全部位于安装根中。Root初次只读检查曾因假定全部在根内而拒绝，纠正准确外部脚本规则后完成核验，未修改原批准或报告。

CI给出的NSIS包SHA256为 `3b131d51b31b6f58e42c68f4d126463b9d0fbca128091c01857adaba5447020a`。本次Root只下载测试记录，未独立下载安装器或在本机安装；不能冒称公开安装包下载验收。证据来自固定Windows原生CI实际安装，不覆盖macOS、私网数据库、后续产品、发行签名或公证，也不新增公开发行计数。
