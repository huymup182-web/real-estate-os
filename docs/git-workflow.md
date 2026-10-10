# Git workflow

## Branch

| Branch      | Vai trò                                                                               | Tạo từ                               | Merge vào                          |
| ----------- | ------------------------------------------------------------------------------------- | ------------------------------------ | ---------------------------------- |
| `main`      | Code ổn định, sẵn sàng phát hành. Chỉ nhận merge từ `develop` (hoặc `fix/*` khẩn cấp) | —                                    | —                                  |
| `develop`   | Nhánh tích hợp. Mọi task hoàn thành được merge vào đây                                | `main`                               | `main`                             |
| `feature/*` | Một task mới, vd `feature/task-049-create-property`                                   | `develop`                            | `develop`                          |
| `fix/*`     | Sửa lỗi, vd `fix/task-052-update-validation`                                          | `develop` (hoặc `main` nếu khẩn cấp) | `develop` (và `main` nếu khẩn cấp) |

Tên branch: chữ thường, kebab-case, nên có mã task. Kiểm tra bằng `sh scripts/check-branch-name.sh`; hook `pre-push` chặn push từ branch sai tên.

## Quy trình cho mỗi task

```text
develop ──► feature/task-xxx-... ──► commit(s) ──► npm run check ──► push ──► Pull Request vào develop ──► review ──► merge
```

1. `git switch develop && git pull`
2. `git switch -c feature/task-xxx-mo-ta`
3. Code + test, chạy `npm run check` (và test của phần liên quan).
4. Commit theo quy tắc bên dưới, `git push -u origin feature/task-xxx-mo-ta`.
5. Mở Pull Request vào `develop`, điền theo template (Task, Summary, Files changed, Architecture impact, Tests executed, Test result, Known issues, Next recommended task).
6. Merge bằng **Squash and merge** để mỗi task là một commit trên `develop`. Xoá branch sau khi merge.
7. Khi `develop` ổn định ở một mốc (vd hết một phase), mở PR `develop` → `main` và merge bằng **Create a merge commit**.

Không commit trực tiếp lên `main` hoặc `develop`. Không force-push lên hai nhánh này.

## Quy tắc commit (Conventional Commits)

```text
<type>(<scope>): <mô tả ngắn> (TASK-xxx)

<thân: giải thích cái gì và vì sao, tuỳ chọn>
```

| type       | Khi nào                              |
| ---------- | ------------------------------------ |
| `feat`     | Tính năng mới                        |
| `fix`      | Sửa lỗi                              |
| `docs`     | Chỉ tài liệu                         |
| `style`    | Định dạng, không đổi logic           |
| `refactor` | Đổi cấu trúc code, không đổi hành vi |
| `perf`     | Tối ưu hiệu năng                     |
| `test`     | Thêm/sửa test                        |
| `build`    | Build, dependency, Docker            |
| `ci`       | GitHub Actions                       |
| `chore`    | Việc lặt vặt khác (cấu hình, script) |
| `revert`   | Hoàn tác commit trước                |

- `scope` tuỳ chọn, chữ thường: `backend`, `admin`, `mobile`, `database`, `docker`, `docs`...
- Thêm `!` sau type/scope khi thay đổi phá vỡ tương thích: `feat(backend)!: ...`
- Dòng đầu tối đa 100 ký tự, viết ở thể mệnh lệnh, không chấm câu cuối.
- Ghi mã task ở cuối dòng đầu.

Ví dụ:

```text
feat(database): add companies table migration (TASK-007)
fix(backend): reject cross-tenant property access (TASK-047)
docs: describe git workflow (TASK-005)
```

Hook `commit-msg` kiểm tra tự động. Hook được bật khi chạy `npm install` ở thư mục gốc (script `prepare` đặt `git config core.hooksPath .githooks`). Bật thủ công: `git config core.hooksPath .githooks`.

## Bảo vệ branch trên GitHub (khuyến nghị)

Trong Settings → Branches (hoặc Rules) của repo, bật cho `main` và `develop`:

- Require a pull request before merging
- Block force pushes và chặn xoá branch
- Khi có CI: Require status checks to pass
