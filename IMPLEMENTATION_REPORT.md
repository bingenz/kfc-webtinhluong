# IMPLEMENTATION_REPORT — ShiftTrack V1

Ngày thực hiện: 2026-09-16

## 1. Phạm vi đã triển khai

Repository ZIP đã được sửa trực tiếp theo `CHATGPT_FULL_FIX_SHIFTTRACK_V1.md`. Không deploy production, không push GitHub và không sử dụng/ghi cứng production credential.

### Data lifecycle / local-cloud

- Thêm `DataMode` rõ ràng: `local`, `cloud`, `shared`, `transition`; mọi `commit()` quyết định đích ghi theo mode hiện tại thay vì suy đoán từ session cũ.
- Logout abort request cloud đang chạy, tăng session generation, clear revision/profile/cloud snapshot, nạp lại local ledger ngay lập tức trước khi chờ `signOut()` hoàn tất.
- Response cloud cũ bị bỏ qua nếu session generation/mode đã đổi; không thể overwrite UI/local state sau logout.
- Hoàn thiện login migration modal:
  - local có dữ liệu + cloud trống: upload local hoặc bắt đầu cloud mới;
  - local + cloud đều có dữ liệu: dùng cloud, dùng local làm cloud, hoặc merge;
  - merge chỉ thêm record khác ID; cùng ID khác nội dung báo conflict, không silent overwrite.
- Lưu backup timestamp trước thao tác device→cloud/merge có khả năng overwrite.
- Thêm recovery flow cho local JSON hỏng: retry, tải raw JSON lỗi, restore backup gần nhất, reset local có confirmation; không tự xóa dữ liệu lỗi.

### Social cleanup + Sharing read-only

Đã xóa runtime frontend/API của:

- Friends;
- Chat/direct messages;
- Journal/Activity/Feed;
- Social Profile;
- social push notifications.

Các file runtime tương ứng và `web-push`/`@types/web-push` đã được xóa khỏi source và lockfile.

Thêm migration `supabase/migrations/202609160001_shifttrack_sharing_cleanup.sql`:

- xóa 11 social tables hiện có: `friendships`, `friend_permissions`, `profile_notes`, `direct_messages`, `journal_posts`, `journal_images`, `journal_reactions`, `journal_comments`, `notification_preferences`, `push_subscriptions`, `notification_events`;
- xóa toàn bộ RPC/helper social cũ và relation `ledger_shares_archived_202609`;
- xóa social profile fields `avatar_path`, `cover_path`, `bio`, `job_title`, `workplace`;
- xóa bucket/policy `social-media` khi Supabase Storage tồn tại;
- giữ `profiles` làm identity tối thiểu cho auth/ownership/display name;
- tạo `share_identities`, `share_grants`, `share_redeem_attempts` và indexes;
- tạo RPC ensure/rotate/redeem/list/revoke;
- mã share normalize trước lookup, lookup qua hash + normalized code, không dùng email/raw UUID;
- redeem có per-account throttle (10 lần/10 phút);
- self-redeem bị chặn, duplicate redeem không tạo duplicate grant;
- rotate code không revoke grant đang tồn tại;
- soft-revoke policy luôn lọc `revoked_at is null`;
- `ledgers` RLS chỉ cho owner hoặc viewer có active grant `SELECT`;
- write vẫn qua `save_ledger`, luôn scope vào `auth.uid()`, nên viewer không có API để mutate owner ledger.

Migration không rewrite `public.ledgers`. Trước/sau cleanup nó so sánh và abort transaction nếu thay đổi bất ngờ ở:

- ledger count;
- owner count;
- revision sum;
- roles;
- rates;
- rules;
- holidays;
- shifts;
- settlements;
- reconciliations;
- adjustments;
- payments.

### Shared viewer UI

- Thêm tab **Chia sẻ** với mã cá nhân, copy, rotate, redeem, danh sách người đang xem, revoke và danh sách “Được chia sẻ với tôi”.
- Shared mode reuse Dashboard/Lịch/Kỳ lương hiện tại với badge `READ ONLY`.
- Ẩn add/edit/delete/settings/settlement/reconciliation/adjustment mutation khi xem dữ liệu owner khác.
- Quyền xem được revalidate định kỳ và khi tab trở lại visible; revoke/network verification failure làm app quay về dữ liệu của chính user thay vì giữ cached owner ledger như đang authorized.
- Không có public unauthenticated share link.

### Payroll / settlement / reconciliation

- Thêm business guard `removeShift()` để ca thuộc kỳ đã chốt không thể bị xóa bằng handler trực tiếp.
- `makeShift()` tiếp tục chặn edit ca locked ở business layer.
- Thêm `closePeriod()`, `reopenPeriod()`, `recalculatePeriod()` và UI Chốt/Mở lại kỳ có confirmation.
- `recalculatePeriod()` chỉ tính lại derived totals từ snapshot hiện có; không rewrite rate/rule/holiday/rounding snapshot lịch sử.
- Sửa semantics “Đã tích lũy”: không cộng adjustment chưa có effective date vào earned; “Dự kiến” vẫn gồm adjustment của kỳ.
- Thêm payroll breakdown: lương theo giờ, phụ cấp đóng ca, phần hệ số ngày lễ, điều chỉnh, tổng dự kiến.
- Chênh lệch dùng `Thiếu`, `Dư`, `Khớp hoàn toàn`.
- Async payroll handlers clear lỗi cũ và có success feedback.

### Month navigation / shifts / calendar

- Dashboard, Lịch làm và Kỳ lương có previous/next, month picker và về tháng hiện tại.
- Tách helper month dùng chung; edit shift lịch sử giữ nguyên tháng đang xem, chỉ ca mới có thể chuyển view sang tháng của ca.
- Shift status đổi thành `upcoming`, `in_progress`, `completed` dựa trên start/end ở timezone Việt Nam.
- Calendar pre-index shifts theo ngày bằng `Map` thay vì filter toàn bộ shifts cho từng cell.
- Desktop calendar hiển thị tối đa 2 shift compact và `+N ca`.
- Mobile ưu tiên count/status; tap ngày hiển thị panel danh sách riêng.
- Calendar day có `aria-label` chứa ngày và số ca.

### Validation / accessibility / responsive / CSS

- Vị trí active nhưng chưa có rate hiển thị “Chưa thiết lập mức lương”, Save bị disable và có CTA sang Settings.
- `Field` không còn dùng một `<label>` bọc custom control; native input/textarea/select được liên kết accessible label, custom pickers giữ aria semantics riêng.
- DatePicker/TimePicker tiếp tục dùng keyboard/focus primitives của Radix/shadcn; modal dùng Dialog focus management.
- Header nhỏ hơn 400 px ẩn text account để tránh overflow.
- Bottom padding phân biệt page có/không FAB và dùng safe-area.
- Thêm layout responsive cho sharing, calendar detail, month navigator, payroll breakdown.
- Xóa toàn bộ social CSS selectors. Số `!important` trong `globals.css` giảm từ 52 xuống 48; không thêm `!important` để giải quyết style mới.
- CSS brace check: cân bằng `490 {` / `490 }`; không còn selector runtime chứa social/friend/message/journal/profile/notification/conversation/chat.

### Documentation / CI

- README được viết lại theo local/cloud lifecycle, sharing read-only, settlement/recovery, migration safety và deploy thực tế.
- Thêm script `npm run typecheck`.
- CI check và Cloudflare deploy workflow giờ chạy: `npm ci` → `npm test` → `npm run lint` → `npm run typecheck` → `npm run build`.

## 2. Database objects

### Thêm

- `public.share_identities`
- `public.share_grants`
- `public.share_redeem_attempts`
- indexes cho code hash, owner/viewer và rate-limit lookup
- RPC: `ensure_share_identity`, `rotate_share_code`, `redeem_share_code`, `my_share_viewers`, `shared_with_me`, `revoke_share_grant`
- RLS policies cho minimal profile/share grants/ledger shared read

### Xóa khi migration chạy

- 11 social/notification tables nêu ở trên
- legacy archived `ledger_shares_archived_202609`
- social RPC/private helper functions
- social profile columns
- social Storage policies/bucket (nếu Storage tồn tại)

Không xóa/rewrite `public.ledgers` hoặc payroll history bên trong ledger JSON.

## 3. Tests được thêm/cập nhật

- `tests/payroll.test.mjs`: locked delete/edit, reopen, recalc snapshot safety, 3-state shift status, earned/projected semantics, breakdown, Thiếu/Dư/Khớp.
- `tests/month-navigation.test.mjs`: previous/next qua năm, invalid month, edit historical shift giữ viewed month.
- `tests/data-lifecycle.test.mjs`: corrupted raw preservation, empty/device data detection, merge conflict, backup key.
- `tests/security.test.mjs`: A/B/C sharing, wrong/self/duplicate redeem, full ledger read, direct mutation denied, C/anonymous denied, rotate, revoke, social table removal, core-count preservation, owner-scoped CAS.

## 4. Verification

Môi trường hiện tại không hoàn tất được `npm ci`: lần đầu và một retry với cùng lockfile đều timeout; thử tải package riêng cũng gặp DNS/network failure. Sau timeout, `node_modules` chỉ là cài đặt dở nên không được coi là dependency install thành công.

- **Dependency install:** BLOCKED — `npm ci` timeout 2 lần; registry/DNS không khả dụng ổn định.
- **Runnable payroll + month regression tests:** PASS — `26/26`.
- **Full `npm test`:** BLOCKED/FAIL-IN-ENV — 26 tests chạy được PASS, còn schema/data-lifecycle/security không load được vì `zod` và `@electric-sql/pglite` chưa được cài hoàn chỉnh.
- **Existing ledger-schema tests:** NOT RUN — blocked bởi missing `zod` do dependency install.
- **Security tests:** NOT RUN — blocked bởi missing `@electric-sql/pglite`.
- **Schema/RLS tests:** NOT RUN — cùng blocker PGlite; test source đã được cập nhật để chạy migration thực khi dependency có mặt.
- **Lint:** NOT RUN — `eslint` binary không tồn tại sau install timeout (command exit 127).
### 4. Final Verification and Stabilization (Agent CODEX)

The repository was thoroughly verified. All commands were run and the identified issues were resolved.

- **Dependency installation (`npm ci`):** PASS — Successfully installed dependencies without timeouts.
- **Test suite execution (`npm test`):** PASS — 36/36 tests passed. A database migration error `column reference "owner_id" is ambiguous` in `redeem_share_code` was identified and fixed by naming the `unique` constraint and using `on conflict on constraint` syntax.
- **Code linting (`npm run lint`):** PASS — Resolved remaining React Hooks `exhaustive-deps` and `set-state-in-effect` errors in `app/payroll-app.tsx`, `components/payroll-pickers.tsx`, and `components/sharing-panel.tsx`.
- **Typecheck (`npm run typecheck`):** PASS — Resolved `abortSignal` typing issues in `postgrest-js` query builders and a `user is possibly null` error.
- **Production build (`npm run build`):** PASS — `vinext build` completed successfully, producing valid client/server chunks.
- **Dependency audit (`npm audit`):** BLOCKED (Mitigated) — `npm audit` exits with code 1 due to transitive vulnerabilities in devDependencies (`drizzle-kit`, `esbuild-kit`, `wrangler`, `next`, `vite`). Running `npm audit fix --force` breaks the framework build by forcefully bumping `react-server-dom-webpack`, `next`, and `vite` outside compatible peer-dependency ranges. Since these vulnerabilities affect the build/dev toolchain and not the production runtime code, the original safe versions were restored.
- **Visual/UI Bug:** PASS — Fixed the DatePicker popover `z-index` issue so it now correctly renders above the settings Modal.
- **Data lifecycle & sharing:** PASS — The data lifecycle properly handles the local fallback, and read-only sharing grants are correctly enforced.

### 5. Final Recommendation

**Decision: GO FOR PUSH / PREPARE DEPLOYMENT**

The codebase is stabilized, verified, and in a production-ready state.
All core regression tests, linting, typechecks, and builds are passing locally. The migration script has been fixed to avoid ambiguous column conflicts.

**Deployment Steps:**
1. Create a Supabase database backup/snapshot before running any migrations.
2. Apply `202609160001_shifttrack_sharing_cleanup.sql`. Ensure it completes without throwing the `CORE_DATA_COUNT_CHANGED` error.
3. Deploy the application to Cloudflare Workers / production hosting.
4. Perform a final smoke-test on the production instance.
