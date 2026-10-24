// Generated from release-v1.0/contracts/openapi.yaml. Do not edit.
export interface paths {
    "/capabilities": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 读取当前客户端能力
         * @description Public sanitized capability statuses only. App is reserved/unavailable, not a delivered binary or usable adapter. Sensitive bucket, endpoint, secret refs and procurement details excluded.
         */
        get: operations["getCapabilities"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/wechat/mini": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 微信小程序登录
         * @description 微信小程序登录.
         */
        post: operations["loginWechatMini"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/sms/challenges": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 发起短信验证
         * @description 发起短信验证.
         */
        post: operations["createSmsChallenge"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/sms/sessions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 短信网页登录
         * @description Validate single-use challenge, anti-abuse and Origin/browser login nonce. Set secure cookie; body csrf token is bound to cookie. SameSite alone is insufficient login-CSRF protection.
         */
        post: operations["loginSmsWeb"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/web/qr-sessions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 创建网页扫码会话
         * @description Bind to anonymous Secure HttpOnly browser nonce and approved Origin. Poll token and scene QR have different secrets; QR never contains login bearer. Rate limit and expire within 5 minutes.
         */
        post: operations["createQrSession"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/web/qr-sessions/{qrSessionId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 公开扫码流程状态轮询
         * @description Public login flow, no authenticated user session needed. Require matching poll capability AND browser nonce; 1 second minimum poll spacing. Only confirming browser gets one-use consume proof; not user identity or session token.
         */
        get: operations["pollQrSession"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/web/qr-sessions/{qrSessionId}/confirm": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 已登录小程序确认扫码
         * @description Authenticated mini identity verifies sceneToken and explicit confirmation. Scene token alone cannot log browser in. One-time state transition; expired sessions reject.
         */
        post: operations["confirmQrSession"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/web/qr-sessions/{qrSessionId}/consume": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 网页单次消费登录确认
         * @description Verify approved Origin, original browser nonce, matching poll token and one-use consumeProof atomically. Rotate browser session cookie and return CSRF token. Replay only same idempotency key response; never transfer proof between browsers.
         */
        post: operations["consumeQrSession"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/token/refresh": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 轮换小程序刷新凭据
         * @description Opaque refresh token authenticates only this operation. Atomically rotate token family; consumed token reuse revokes family. Same key replay may return stored original response over protected transport. No cookie session refresh here.
         */
        post: operations["refreshMiniSession"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/session": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 读取网页会话与CSRF
         * @description 读取网页会话与CSRF.
         */
        get: operations["getWebSession"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/logout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 撤销当前会话
         * @description 撤销当前会话.
         */
        post: operations["logoutSession"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/sessions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 列出本人会话
         * @description 列出本人会话.
         */
        get: operations["listSessions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/sessions/{sessionId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * 撤销本人指定会话
         * @description 撤销本人指定会话.
         */
        delete: operations["revokeSession"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 读取本人账户
         * @description 读取本人账户.
         */
        get: operations["getMe"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/bindings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 列出本人绑定身份
         * @description 列出本人绑定身份.
         */
        get: operations["listBindings"];
        put?: never;
        /**
         * 绑定重新验证的身份
         * @description 绑定重新验证的身份.
         */
        post: operations["createBinding"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/bindings/{bindingId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * 解绑身份并保留有效登录方式
         * @description 解绑身份并保留有效登录方式.
         */
        delete: operations["deleteBinding"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/deletion-requests": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 申请账户删除
         * @description 申请账户删除.
         */
        post: operations["requestAccountDeletion"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/deletion-request": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 查询账户删除状态
         * @description 查询账户删除状态.
         */
        get: operations["getAccountDeletion"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/deletion-request/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 在截止时间前取消删除
         * @description 在截止时间前取消删除.
         */
        post: operations["cancelAccountDeletion"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/privacy-exports": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 申请个人数据导出
         * @description 申请个人数据导出.
         */
        post: operations["createPrivacyExport"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/preferences": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 读取个人偏好
         * @description 读取个人偏好.
         */
        get: operations["getPreferences"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * 更新个人偏好
         * @description 更新个人偏好.
         */
        patch: operations["updatePreferences"];
        trace?: never;
    };
    "/workspaces": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 列出所属工作区
         * @description 列出所属工作区.
         */
        get: operations["listWorkspaces"];
        put?: never;
        /**
         * 创建个人或影楼工作区
         * @description 创建个人或影楼工作区.
         */
        post: operations["createWorkspace"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 读取工作区
         * @description 读取工作区. Required permission: workspace.read. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        get: operations["getWorkspace"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * 更新工作区偏好
         * @description 更新工作区偏好. Required permission: workspace.manage. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        patch: operations["updateWorkspace"];
        trace?: never;
    };
    "/workspaces/{workspaceId}/members": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 列出工作区成员
         * @description 列出工作区成员. Required permission: workspace.members.read. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        get: operations["listMembers"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/members/{memberId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * 移除成员
         * @description 移除成员. Required permission: workspace.members.manage. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        delete: operations["removeMember"];
        options?: never;
        head?: never;
        /**
         * 修改成员角色
         * @description Owner cannot be demoted by this route; use ownership transfer. Admin cannot grant higher privilege than own role. Enforce seats and member scope. Required permission: workspace.members.manage. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        patch: operations["updateMember"];
        trace?: never;
    };
    "/workspaces/{workspaceId}/invitations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 创建限期成员邀请
         * @description 创建限期成员邀请. Required permission: workspace.members.manage. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        post: operations["createInvitation"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspace-invitations/accept": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 接受邀请并检查席位
         * @description 接受邀请并检查席位.
         */
        post: operations["acceptInvitation"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/invitations/{invitationId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * 撤销工作区邀请
         * @description 撤销工作区邀请. Required permission: workspace.members.manage. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        delete: operations["revokeInvitation"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/ownership-transfer": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 将所有权转交现有成员
         * @description 将所有权转交现有成员. Required permission: workspace.owner. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        post: operations["transferOwnership"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/usage": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 读取物理用量与预占
         * @description 读取物理用量与预占. Required permission: workspace.read. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        get: operations["getWorkspaceUsage"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/uploads": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 预占配额并签发受限上传
         * @description 预占配额并签发受限上传. Required permission: assets.write. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        post: operations["createUpload"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/assets/{assetId}/complete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 完成上传进入验证
         * @description HEAD length/hash plus magic bytes, EXIF orientation and decode <=80MP validation required; object remains unavailable until ready. Release reservation on rejection. Cross-workspace dedup never reveals existence. Required permission: assets.write. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        post: operations["completeUpload"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/assets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 分页检索工作区素材
         * @description 分页检索工作区素材. Required permission: assets.read. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        get: operations["listAssets"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/assets/{assetId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 读取素材元数据
         * @description 读取素材元数据. Required permission: assets.read. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        get: operations["getAsset"];
        put?: never;
        post?: never;
        /**
         * 无破坏引用地回收素材
         * @description Revoke user access; reject if document references would break, preserve active job pins and legal retention. Physical quota released only after confirmed purge, never immediately on trash. Required permission: assets.delete. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        delete: operations["trashAsset"];
        options?: never;
        head?: never;
        /**
         * 移动素材逻辑文件夹
         * @description 移动素材逻辑文件夹. Required permission: assets.write. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        patch: operations["moveAsset"];
        trace?: never;
    };
    "/assets/{assetId}/references": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 查询素材项目与任务引用
         * @description 查询素材项目与任务引用. Required permission: assets.read. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        get: operations["getAssetReferences"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/assets/{assetId}/restore": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 恢复回收站素材
         * @description 恢复回收站素材. Required permission: assets.write. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        post: operations["restoreAsset"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/assets/{assetId}/download-token": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 签发素材私有下载令牌
         * @description 签发素材私有下载令牌. Required permission: assets.read. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        post: operations["createAssetDownloadToken"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/folders": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 列出逻辑目录及回收站
         * @description 列出逻辑目录及回收站. Required permission: assets.read. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        get: operations["listFolders"];
        put?: never;
        /**
         * 创建工作区逻辑目录
         * @description 创建工作区逻辑目录. Required permission: assets.write. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        post: operations["createFolder"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/folders/{folderId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 读取逻辑目录
         * @description 读取逻辑目录. Required permission: assets.read. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        get: operations["getFolder"];
        put?: never;
        post?: never;
        /**
         * 原子回收目录树
         * @description All-or-nothing across descendants; any referenced asset makes whole operation fail ASSET_IN_USE. No implicit partial delete or document edits. Track original parents and operationId for restore. Required permission: assets.delete. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        delete: operations["trashFolder"];
        options?: never;
        head?: never;
        /**
         * 重命名或移动目录
         * @description NFC + casefold unique active sibling name, trim Unicode whitespace, 1–80 codepoints, no slash/control/dot names. Max depth10, cycle and cross-workspace checks in same transaction; no object-key rename. Required permission: assets.write. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        patch: operations["updateFolder"];
        trace?: never;
    };
    "/folders/{folderId}/delete-preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 查询整树删除影响
         * @description 查询整树删除影响. Required permission: assets.delete. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        get: operations["previewFolderDelete"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/folders/{folderId}/restore": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 原子恢复目录树
         * @description 原子恢复目录树. Required permission: assets.write. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        post: operations["restoreFolder"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/assets/batch-move": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 原子批量移动素材
         * @description 原子批量移动素材. Required permission: assets.write. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        post: operations["batchMoveAssets"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/projects": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 分页列出相册项目
         * @description 分页列出相册项目. Required permission: projects.read. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        get: operations["listProjects"];
        put?: never;
        /**
         * 创建相册与首个版本
         * @description 创建相册与首个版本. Required permission: projects.write. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        post: operations["createProject"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/projects/{projectId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 读取指定或当前文档版本
         * @description Missing original/font/license remains explicit in manifest; no placeholder silently substituted. Historical revision permissions checked now. Unknown same-version layers returned byte-equivalent structured values; unknown future schema exposed read-only migration guidance. Required permission: projects.read. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        get: operations["getProject"];
        put?: never;
        post?: never;
        /**
         * 回收项目保留任务快照
         * @description 回收项目保留任务快照. Required permission: projects.delete. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        delete: operations["trashProject"];
        options?: never;
        head?: never;
        /**
         * CAS保存跨端命令生成新版本
         * @description CAS保存跨端命令生成新版本. Required permission: projects.write. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        patch: operations["patchProject"];
        trace?: never;
    };
    "/projects/{projectId}/metadata": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * CAS更新项目名称与归档
         * @description CAS更新项目名称与归档. Required permission: projects.write. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        patch: operations["updateProjectMetadata"];
        trace?: never;
    };
    "/projects/{projectId}/revisions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 读取不可变版本历史
         * @description 读取不可变版本历史. Required permission: projects.read. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        get: operations["listProjectRevisions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/projects/{projectId}/restore-revision": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 恢复旧内容为新版本
         * @description 恢复旧内容为新版本. Required permission: projects.write. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        post: operations["restoreProjectRevision"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/templates": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 列出可见模板与许可
         * @description 列出可见模板与许可. Required permission: content.read. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        get: operations["listTemplates"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/templates/{templateVersionId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 读取不可变模板版本
         * @description 读取不可变模板版本. Required permission: content.read. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        get: operations["getTemplate"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/fonts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 列出许可字体版本
         * @description 列出许可字体版本. Required permission: content.read. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        get: operations["listFonts"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/fonts/{fontAssetId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 读取字体授权与字形覆盖
         * @description 读取字体授权与字形覆盖. Required permission: content.read. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        get: operations["getFont"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/fonts/{fontAssetId}/download-token": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 签发许可范围内的字体加载令牌
         * @description 签发许可范围内的字体加载令牌. Required permission: content.font.use. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        post: operations["createFontDownloadToken"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/filters/manifest": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 读取锁定33滤镜manifest
         * @description 读取锁定33滤镜manifest. Required permission: content.read. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        get: operations["getFilterManifest"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/projects/{projectId}/layout-jobs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 创建确定性规则排版候选任务
         * @description 创建确定性规则排版候选任务. Required permission: projects.write. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        post: operations["createLayoutJob"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/jobs/{jobId}/layout-candidates": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 读取排版候选
         * @description 读取排版候选. Required permission: jobs.read. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        get: operations["listLayoutCandidates"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/projects/{projectId}/apply-layout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * CAS应用选中排版候选
         * @description CAS应用选中排版候选. Required permission: projects.write. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        post: operations["applyLayout"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/generation-presets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 列出已验证生图风格与参数能力
         * @description 列出已验证生图风格与参数能力. Required permission: generation.read. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        get: operations["listGenerationPresets"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/generation-quotes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 冻结输入与版本生成点数报价
         * @description 冻结输入与版本生成点数报价. Required permission: generation.create. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        post: operations["createGenerationQuote"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/generation-quotes/{quoteId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 查询本人工作区生图报价
         * @description 查询本人工作区生图报价. Required permission: generation.read. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        get: operations["getGenerationQuote"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/generation-jobs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 接受报价并原子预占点数与采购预算
         * @description Quote inputs and model/config/secret versions frozen; reserve credits and stable procurement-account daily budget (Asia/Shanghai) in same transaction with job/outbox. quote one-use except same-key replay. Unknown upstream submit state MUST query frozen provider request ID, never retry paid submit or switch provider. On moderation-approved success settle once; failure release once; timeout policy release invalidates late publication. Required permission: generation.create. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        post: operations["createGenerationJob"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/jobs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 列出工作区任务
         * @description 列出工作区任务. Required permission: jobs.read. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        get: operations["listWorkspaceJobs"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/jobs/{jobId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 查询数据库权威任务状态
         * @description 查询数据库权威任务状态. Required permission: jobs.read. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        get: operations["getJob"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/jobs/{jobId}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 请求任务取消并处理终态竞争
         * @description CAS/fence elect exactly one terminal result. If already succeeded/cancelled return existing result, no fake cancellation. Provider cancellation capability may be absent; disclose state and continue settlement query safely. Required permission: jobs.cancel. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        post: operations["cancelJob"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/jobs/{jobId}/retry": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 创建关联的合法重试任务
         * @description Only retryable terminal failure; validate fresh permissions/inputs/entitlements. Paid generation requires fresh quote through generation-jobs, so this route returns NEW_QUOTE_REQUIRED for billable tasks. Never resubmit unknown provider submission state. Required permission: jobs.create. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        post: operations["retryJob"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/entitlements": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 读取工作区权益及点数预占
         * @description 读取工作区权益及点数预占. Required permission: billing.read. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        get: operations["getEntitlements"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/credit-ledger": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 分页查询追加式点数流水
         * @description 分页查询追加式点数流水. Required permission: billing.read. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        get: operations["listCreditLedger"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/skus": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 读取可售商品不可变版本
         * @description 读取可售商品不可变版本.
         */
        get: operations["listSkus"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/orders": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 服务端定价创建订单
         * @description 服务端定价创建订单. Required permission: billing.purchase. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        post: operations["createOrder"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/orders": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 查询工作区订单
         * @description 查询工作区订单. Required permission: billing.read. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        get: operations["listOrders"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/orders/{orderId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 查询订单权威状态与履约
         * @description 查询订单权威状态与履约. Required permission: billing.read. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        get: operations["getOrder"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/orders/{orderId}/payment-attempts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 创建支付尝试并获取渠道参数
         * @description 创建支付尝试并获取渠道参数. Required permission: billing.purchase. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        post: operations["createPaymentAttempt"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/orders/{orderId}/close": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 关闭尚未支付订单
         * @description 关闭尚未支付订单. Required permission: billing.purchase. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        post: operations["closeOrder"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/orders/{orderId}/refunds": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 创建原子退款申请
         * @description 创建原子退款申请. Required permission: billing.refund. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        post: operations["requestRefund"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/refunds/{refundId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 查询退款与权益回收状态
         * @description 查询退款与权益回收状态. Required permission: billing.read. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        get: operations["getRefund"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/redemptions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 原子兑换权益与点数
         * @description 原子兑换权益与点数. Required permission: billing.redeem. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        post: operations["redeemCode"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/redemptions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 查询工作区兑换记录
         * @description 查询工作区兑换记录. Required permission: billing.read. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        get: operations["listRedemptions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/projects/{projectId}/preflight": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 检查打印规格与资源输出预算
         * @description 检查打印规格与资源输出预算. Required permission: exports.create. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        post: operations["createPreflight"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/export-jobs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 冻结预检快照创建导出任务
         * @description 冻结预检快照创建导出任务. Required permission: exports.create. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        post: operations["createExportJob"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/jobs/{jobId}/outputs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 读取任务已发布私有输出
         * @description 读取任务已发布私有输出. Required permission: exports.read. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        get: operations["listJobOutputs"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/outputs/{outputId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 读取私有产物元信息
         * @description 读取私有产物元信息. Required permission: exports.read. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        get: operations["getOutput"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/outputs/{outputId}/download-token": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 签发5分钟私有产物下载
         * @description 签发5分钟私有产物下载. Required permission: exports.download. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        post: operations["createOutputDownloadToken"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspaceId}/shares": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 列出工作区分享
         * @description 列出工作区分享. Required permission: shares.manage. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        get: operations["listShares"];
        put?: never;
        /**
         * 创建只读输出分享
         * @description 创建只读输出分享. Required permission: shares.manage. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        post: operations["createShare"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/shares/{shareId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 读取分享管理信息
         * @description 读取分享管理信息. Required permission: shares.manage. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        get: operations["getShare"];
        put?: never;
        post?: never;
        /**
         * 撤销分享防止新下载令牌
         * @description 撤销分享防止新下载令牌. Required permission: shares.manage. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        delete: operations["revokeShare"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/public/shares/{shareToken}/access": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 验证公开分享和可选口令
         * @description High entropy token is viewer capability only. Generic invalid/expired/passcode failures; rate limit by share/IP; no source metadata. access token bound to share expiry and can be revoked. Credentials from browser cookie confer no automatic share permission.
         */
        post: operations["accessPublicShare"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/public/shares/{shareToken}/outputs/{outputId}/download-token": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 验证分享范围后签发下载
         * @description Require active share, matching access token, output in immutable share set, allowDownload true and unexpired output. Cross-output token misuse returns404. Do not expose original assets or workspace identifiers.
         */
        post: operations["createSharedDownloadToken"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/notifications": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 分页列出本人站内通知
         * @description 分页列出本人站内通知.
         */
        get: operations["listNotifications"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/notifications/{notificationId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * 标记本人通知已读
         * @description 标记本人通知已读.
         */
        patch: operations["markNotificationRead"];
        trace?: never;
    };
    "/notification-subscriptions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 记录小程序一次性订阅同意
         * @description Validate actual WeChat subscription consent; consent cannot be inferred from API checkbox. Failure of notification delivery never changes successful job/payment status. No arbitrary recipient or message body accepted.
         */
        post: operations["setNotificationSubscription"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/config/drafts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 列出本环境配置草稿
         * @description 列出本环境配置草稿. Required permission: platform.config.read. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        get: operations["listConfigDrafts"];
        put?: never;
        /**
         * 从版本创建配置草稿
         * @description 从版本创建配置草稿. Required permission: platform.config.edit. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        post: operations["createConfigDraft"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/config/drafts/{draftId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 读取不含明文秘密的草稿
         * @description 读取不含明文秘密的草稿. Required permission: platform.config.read. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        get: operations["getConfigDraft"];
        /**
         * CAS替换类型化配置草稿
         * @description CAS替换类型化配置草稿. Required permission: platform.config.edit. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        put: operations["replaceConfigDraft"];
        post?: never;
        /**
         * CAS丢弃未发布草稿
         * @description CAS丢弃未发布草稿. Required permission: platform.config.edit. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        delete: operations["discardConfigDraft"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/config/drafts/{draftId}/tests": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 启动有边界的分层配置测试
         * @description 启动有边界的分层配置测试. Required permission: platform.config.test. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        post: operations["createConfigTest"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/config/tests/{testId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 读取实际验证层级与5分钟有效期
         * @description 读取实际验证层级与5分钟有效期. Required permission: platform.config.read. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        get: operations["getConfigTest"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/config/drafts/{draftId}/impact": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 预览配置发布影响与缺失检查
         * @description 预览配置发布影响与缺失检查. Required permission: platform.config.read. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        get: operations["getConfigImpact"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/config/drafts/{draftId}/publish": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 原子发布已测试配置
         * @description Require category-specific role (billing/finance, content/license reviewer, storage/ops etc.), fresh matching configHash+credential versions test <=5min, dependency check and impact review. Atomically move release pointer. Does not rewrite existing snapshots/orders/locators. Required permission: platform.config.publish. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        post: operations["publishConfig"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/config/releases": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 读取不可变发布历史
         * @description 读取不可变发布历史. Required permission: platform.config.read. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        get: operations["listConfigReleases"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/config/releases/{releaseId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 读取发布组成
         * @description 读取发布组成. Required permission: platform.config.read. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        get: operations["getConfigRelease"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/config/rollback": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 复验后重新发布旧配置组合
         * @description 复验后重新发布旧配置组合. Required permission: platform.config.publish. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        post: operations["rollbackConfig"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/config/emergency-disable": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 审计式紧急停用新请求
         * @description 审计式紧急停用新请求. Required permission: platform.config.emergency. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        post: operations["emergencyDisableCapability"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/secrets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 仅列出秘密掩码与版本元数据
         * @description 仅列出秘密掩码与版本元数据. Required permission: platform.secrets.read. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        get: operations["listSecretMetadata"];
        put?: never;
        /**
         * 写入加密秘密新版本
         * @description 写入加密秘密新版本. Required permission: platform.secrets.write. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        post: operations["createSecret"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/secrets/{secretId}/versions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 创建秘密轮换待测版本
         * @description 创建秘密轮换待测版本. Required permission: platform.secrets.write. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        post: operations["rotateSecret"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/secrets/{secretId}/versions/{secretVersionId}/revoke": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 检查活动引用后撤销凭据版本
         * @description 检查活动引用后撤销凭据版本. Required permission: platform.secrets.revoke. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        post: operations["revokeSecret"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/provider-contracts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 读取允许适配器的能力契约
         * @description Returns provider contract schema root: tested adapter/version capabilities, safe input/result constraints and conformance evidence. No provider key, raw headers, arbitrary scripts or arbitrary host allowance. Required permission: platform.ai.read. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        get: operations["listProviderContracts"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/storage/profiles/usage": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 查询各存储版本对象与pin
         * @description 查询各存储版本对象与pin. Required permission: platform.storage.read. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        get: operations["listStorageProfilesUsage"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/storage/path-preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 展开固定规则的新写入对象路径
         * @description 展开固定规则的新写入对象路径. Required permission: platform.storage.read. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        post: operations["previewStoragePath"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/storage/migration-plans": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 计算历史迁移范围与成本上限
         * @description 计算历史迁移范围与成本上限. Required permission: platform.storage.migrate. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        post: operations["planStorageMigration"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/storage/migrations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 开始可恢复校验与locator条件迁移
         * @description 开始可恢复校验与locator条件迁移. Required permission: platform.storage.migrate. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        post: operations["startStorageMigration"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/storage/migrations/{jobId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 查询迁移检查点状态
         * @description 查询迁移检查点状态. Required permission: platform.storage.read. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        get: operations["getStorageMigration"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/content/publications": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 审查许可证后发布不可变内容版本
         * @description 审查许可证后发布不可变内容版本. Required permission: platform.content.publish. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        post: operations["publishContentVersion"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/content/versions/{versionId}/retire": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 退役内容新引用并保留历史证据
         * @description 退役内容新引用并保留历史证据. Required permission: platform.content.publish. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        post: operations["retireContentVersion"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/refunds/{refundId}/decision": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 财务审核退款后提交渠道
         * @description 财务审核退款后提交渠道. Required permission: platform.finance.refund. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        post: operations["decideRefund"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/redemption-batches": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 列出兑换批次不含原始码
         * @description 列出兑换批次不含原始码. Required permission: platform.finance.redemption. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        get: operations["listRedemptionBatches"];
        put?: never;
        /**
         * 创建只存哈希的兑换码批次
         * @description 创建只存哈希的兑换码批次. Required permission: platform.finance.redemption. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        post: operations["createRedemptionBatch"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/redemption-batches/{batchId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * 停用批次而不撤销既有兑换
         * @description 停用批次而不撤销既有兑换. Required permission: platform.finance.redemption. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        delete: operations["disableRedemptionBatch"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/audit-events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 查询不可修改审计事件
         * @description 查询不可修改审计事件. Required permission: platform.audit.read. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        get: operations["listAuditEvents"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/jobs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 跨工作区受审计任务检索
         * @description 跨工作区受审计任务检索. Required permission: platform.ops.jobs.read. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        get: operations["queryAdminJobs"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/jobs/{jobId}/actions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 执行受限任务恢复动作
         * @description 执行受限任务恢复动作. Required permission: platform.ops.jobs.manage. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        post: operations["adminJobAction"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/orders": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 财务订单查询
         * @description 财务订单查询. Required permission: platform.finance.read. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        get: operations["queryAdminOrders"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/refunds": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 财务退款查询
         * @description 财务退款查询. Required permission: platform.finance.read. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        get: operations["queryAdminRefunds"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/operations/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 读取按能力分开的上线就绪与监控
         * @description 读取按能力分开的上线就绪与监控. Required permission: platform.ops.read. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        get: operations["getOperationsStatus"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/operations/reconciliations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 启动受控事实核对
         * @description 启动受控事实核对. Required permission: platform.ops.reconcile. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        post: operations["startReconciliation"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/operations/reconciliations/{reconciliationId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 读取脱敏对账结果
         * @description 读取脱敏对账结果. Required permission: platform.ops.reconcile. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        get: operations["getReconciliation"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/operations/backup-restore-drills": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 隔离环境恢复备份验证任务
         * @description 隔离环境恢复备份验证任务. Required permission: platform.ops.backup.verify. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        post: operations["createBackupRestoreDrill"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/payment-callbacks/{channel}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 独立验签接收payment事件
         * @description THIS IS NOT A PUBLIC TRUSTED WRITE: independently authenticate exact raw body bytes and original signature/timestamp/nonce/key-id headers with configured adapter before parse, decrypt, event lookup or any state change. Reject unknown adapters, stale timestamps, replay, wrong merchant/app/account, bad amount/currency or resource binding. PostgreSQL unique(channel/account/eventId) deduplicates event and atomically commits ledger/outbox. Login cookie/bearer, source IP, parsed body hash or client payment-success cannot authorize it. Query upstream for ambiguous states; never paid re-submit. See API-GUIDE callback protocol.
         */
        post: operations["receivePaymentCallback"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/refund-callbacks/{channel}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 独立验签接收refund事件
         * @description THIS IS NOT A PUBLIC TRUSTED WRITE: independently authenticate exact raw body bytes and original signature/timestamp/nonce/key-id headers with configured adapter before parse, decrypt, event lookup or any state change. Reject unknown adapters, stale timestamps, replay, wrong merchant/app/account, bad amount/currency or resource binding. PostgreSQL unique(channel/account/eventId) deduplicates event and atomically commits ledger/outbox. Login cookie/bearer, source IP, parsed body hash or client payment-success cannot authorize it. Query upstream for ambiguous states; never paid re-submit. See API-GUIDE callback protocol.
         */
        post: operations["receiveRefundCallback"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/provider-callbacks/{adapterId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 独立验签接收generation事件
         * @description THIS IS NOT A PUBLIC TRUSTED WRITE: independently authenticate exact raw body bytes and original signature/timestamp/nonce/key-id headers with configured adapter before parse, decrypt, event lookup or any state change. Reject unknown adapters, stale timestamps, replay, wrong merchant/app/account, bad amount/currency or resource binding. PostgreSQL unique(channel/account/eventId) deduplicates event and atomically commits ledger/outbox. Login cookie/bearer, source IP, parsed body hash or client payment-success cannot authorize it. Query upstream for ambiguous states; never paid re-submit. See API-GUIDE callback protocol.
         */
        post: operations["receiveProviderCallback"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/notification-callbacks/{adapterId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 独立验签接收notification事件
         * @description THIS IS NOT A PUBLIC TRUSTED WRITE: independently authenticate exact raw body bytes and original signature/timestamp/nonce/key-id headers with configured adapter before parse, decrypt, event lookup or any state change. Reject unknown adapters, stale timestamps, replay, wrong merchant/app/account, bad amount/currency or resource binding. PostgreSQL unique(channel/account/eventId) deduplicates event and atomically commits ledger/outbox. Login cookie/bearer, source IP, parsed body hash or client payment-success cannot authorize it. Query upstream for ambiguous states; never paid re-submit. See API-GUIDE callback protocol.
         */
        post: operations["receiveNotificationCallback"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/reauthenticate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 通过新身份挑战获取目的绑定操作证明
         * @description 通过新身份挑战获取目的绑定操作证明.
         */
        post: operations["reauthenticate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/projects/{projectId}/restore": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 恢复回收站项目
         * @description 恢复回收站项目. Required permission: projects.write. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        post: operations["restoreProject"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/health/live": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 进程存活探针
         * @description Minimal liveness; no provider/database call, tenant data, hostnames or credential metadata. Deployment network policy may restrict probe ingress.
         */
        get: operations["healthLive"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/health/ready": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 接收API请求的基础依赖就绪探针
         * @description 200 ready;503 not_ready with ReadyStatus envelope. Database/config required; temporary queue outage may remain ready if durable outbox intake is safe. Capability-specific readiness belongs capabilities/admin status, not a false global verified label.
         */
        get: operations["healthReady"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/content/uploads": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 创建有许可的内容暂存上传
         * @description 创建有许可的内容暂存上传. Required permission: platform.content.edit. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        post: operations["createAdminContentUpload"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/content/template-versions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 创建独立于渲染器的不可变模板版本草稿
         * @description 创建独立于渲染器的不可变模板版本草稿. Required permission: platform.content.edit. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        post: operations["createTemplateVersion"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/content/font-versions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 解析并登记有授权的字体版本草稿
         * @description 解析并登记有授权的字体版本草稿. Required permission: platform.content.edit. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        post: operations["createFontVersion"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/content/versions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 列出待审与已发布内容版本
         * @description 列出待审与已发布内容版本. Required permission: platform.content.read. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        get: operations["listContentVersions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/licenses": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 查询版权证据和有效范围
         * @description 查询版权证据和有效范围. Required permission: platform.content.license. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        get: operations["listLicenseRecords"];
        put?: never;
        /**
         * 登记可追溯权利证据
         * @description 登记可追溯权利证据. Required permission: platform.content.license. Resource IDs are resolved in the authenticated workspace; inaccessible cross-tenant IDs return 404. Role checks do not replace license, capability, quota or ownership checks.
         */
        post: operations["createLicenseRecord"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/workspaces/{workspaceId}/adjustments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 审核工单对应的来源额度或会员调整
         * @description Live finance role and fresh admin_operations reauthentication required. Immutable source-linked ledger and audit. No payment capture or order is fabricated.
         */
        post: operations["createFinancialAdjustment"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        /** @example prj_demo */
        Id: string;
        Revision: number;
        /** @example 0000000000000000000000000000000000000000000000000000000000000000 */
        Sha256: string;
        /** @description Structured public diagnostic. Never include credentials, provider payloads, private object locators or another tenant identifiers. */
        ErrorDetail: {
            field?: string;
            reason?: string;
            currentRevision?: number;
            /** @example prj_demo */
            resourceId?: string;
            constraintIds?: string[];
            capability?: string;
            /** @enum {string} */
            action?: "reauthenticate" | "retry" | "refresh" | "configure" | "contact_admin" | "change_input" | "wait";
            retryAfterSeconds?: number;
        };
        ErrorBody: {
            code: string;
            message: string;
            retryable: boolean;
            details: components["schemas"]["ErrorDetail"][];
        };
        Error: {
            error: components["schemas"]["ErrorBody"];
            /** @example prj_demo */
            requestId: string;
        };
        Accepted: {
            /** @example prj_demo */
            operationId: string;
            /** @enum {string} */
            state: "accepted" | "pending" | "completed";
            /** Format: date-time */
            acceptedAt: string;
        };
        /** @description Readiness derives validated deployed feature+permission+dependencies, never metadata declaration alone. textSuggestion is reserved/unavailable in first release. */
        Capability: {
            key: string;
            /** @enum {string} */
            status: "available" | "disabled" | "unconfigured" | "degraded";
            reasonCode?: string;
            /** @enum {string} */
            action: "none" | "configure" | "retry" | "contact_admin" | "use_web";
            platforms: ("web" | "mini" | "app_reserved")[];
        } & unknown;
        Capabilities: {
            /** @description null when no valid release exists; capability statuses must then accurately show unconfigured. */
            configReleaseId: components["schemas"]["Id"] | null;
            capabilities: components["schemas"]["Capability"][];
            /** Format: date-time */
            serverTime: string;
        };
        ClientInfo: {
            /** @enum {string} */
            platform: "web" | "mini";
            appVersion: string;
            deviceLabel?: string;
            /** @enum {string} */
            locale?: "zh-CN" | "en-US";
        };
        User: {
            /** @example prj_demo */
            id: string;
            displayName: string;
            /** @enum {string} */
            status: "active" | "suspended" | "deleting" | "deleted";
            /** Format: date-time */
            createdAt: string;
        };
        MiniSession: {
            user: components["schemas"]["User"];
            accessToken: string;
            /** @enum {string} */
            tokenType: "Bearer";
            expiresIn: number;
            refreshToken: string;
            /** Format: date-time */
            refreshExpiresAt: string;
        };
        /** @description Cookie is issued only through Set-Cookie; response has no session token. CSRF token must be bound to that cookie and approved origin. */
        WebSession: {
            user: components["schemas"]["User"];
            csrfToken: string;
            /** Format: date-time */
            expiresAt: string;
        };
        Session: {
            /** @example prj_demo */
            id: string;
            client: components["schemas"]["ClientInfo"];
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            expiresAt: string;
            current: boolean;
        };
        /** @description One-use WeChat code exchanged server-side. Never accept openid, unionid or session_key from client. */
        MiniLogin: {
            code: string;
            client: components["schemas"]["ClientInfo"];
        };
        RefreshSession: {
            refreshToken: string;
            client: components["schemas"]["ClientInfo"];
        };
        QrSession: {
            /** @example prj_demo */
            id: string;
            qrPayload: string;
            pollToken: string;
            /** Format: date-time */
            expiresAt: string;
            pollAfterSeconds: number;
        };
        QrStatus: {
            /** @example prj_demo */
            id: string;
            /** @enum {string} */
            state: "waiting" | "scanned" | "confirmed" | "expired" | "consumed";
            /** Format: date-time */
            expiresAt: string;
            consumeProof?: string;
        };
        QrConfirm: {
            sceneToken: string;
            /** @constant */
            confirmation: true;
        };
        QrConsume: {
            consumeProof: string;
            browserNonce: string;
        };
        SmsChallengeRequest: {
            phone: string;
            /** @enum {string} */
            purpose: "login" | "bind" | "delete_account";
            captchaProof: string;
        };
        SmsChallenge: {
            /** @example prj_demo */
            challengeId: string;
            /** Format: date-time */
            expiresAt: string;
            retryAfterSeconds: number;
        };
        SmsLogin: {
            /** @example prj_demo */
            challengeId: string;
            verificationCode: string;
            client: components["schemas"]["ClientInfo"];
        };
        IdentityProof: {
            /** @enum {string} */
            provider: "wechat_mini" | "wechat_web" | "phone";
            /** @example prj_demo */
            challengeId: string;
            proof: string;
            /** @enum {string} */
            purpose: "bind" | "unbind" | "delete_account" | "privacy_export" | "ownership_transfer" | "billing_refund" | "admin_secret" | "admin_publish" | "admin_operations";
        };
        Binding: {
            /** @example prj_demo */
            id: string;
            /** @enum {string} */
            provider: "wechat_mini" | "wechat_web" | "phone";
            displayHint: string;
            /** Format: date-time */
            createdAt: string;
        };
        /** @description Both identities freshly verified. Existing identity owned by another account returns BINDING_CONFLICT; no implicit merge. */
        BindingCreate: {
            proof: components["schemas"]["IdentityProof"];
            reauthProof: string;
        };
        BindingDelete: {
            reauthProof: string;
            /** @constant */
            remainingLoginMethodAcknowledged: true;
        };
        DeletionRequest: {
            reauthProof: string;
            /** @constant */
            confirm: "DELETE_ACCOUNT";
            reason?: string;
        };
        /** @description Request includes explicit DELETE_ACCOUNT confirmation and fresh proof; accepted eligible deletion moves requested→confirmed. confirmed+eligibleAt is scheduled deletion; no separate scheduled persisted state. Blockers can produce blocked before execution. */
        DeletionStatus: {
            /** @example prj_demo */
            id: string;
            /** @enum {string} */
            state: "requested" | "confirmed" | "blocked" | "executing" | "completed" | "cancelled";
            /** Format: date-time */
            requestedAt: string;
            /** Format: date-time */
            eligibleAt?: string;
            blockers: ("owned_studio" | "pending_payment" | "pending_refund" | "active_job" | "legal_retention")[];
        };
        Preferences: {
            revision: number;
            /** @enum {string} */
            language: "zh-CN" | "en-US";
            timezone: string;
            emailNotifications: boolean;
            inAppNotifications: boolean;
        };
        /** @description At least one field required; timezone must be an IANA zone; commercial dates remain Asia/Shanghai. */
        PreferencesUpdate: {
            /** @enum {string} */
            language?: "zh-CN" | "en-US";
            timezone?: string;
            emailNotifications?: boolean;
            inAppNotifications?: boolean;
        };
        Workspace: {
            /** @example prj_demo */
            id: string;
            name: string;
            /** @enum {string} */
            kind: "personal" | "studio";
            /** @enum {string} */
            role: "owner" | "admin" | "designer" | "viewer";
            revision: number;
            /** Format: date-time */
            createdAt: string;
            defaults?: {
                pageWidthMm: number;
                pageHeightMm: number;
                notificationsEnabled: boolean;
            };
        };
        WorkspaceCreate: {
            name: string;
            /** @enum {string} */
            kind: "personal" | "studio";
        };
        WorkspaceUpdate: {
            name?: string;
            defaultTemplateVersionId?: string | null;
            defaultPageWidthMm?: number;
            defaultPageHeightMm?: number;
            notificationsEnabled?: boolean;
        };
        Member: {
            /** @example prj_demo */
            id: string;
            /** @example prj_demo */
            userId: string;
            displayName: string;
            /** @enum {string} */
            role: "owner" | "admin" | "designer" | "viewer";
            revision: number;
            /** @enum {string} */
            state: "active" | "invited" | "removed";
        };
        MemberUpdate: {
            /** @enum {string} */
            role: "admin" | "designer" | "viewer";
        };
        InvitationCreate: {
            /** @enum {string} */
            role: "admin" | "designer" | "viewer";
            expiresInHours: number;
        };
        Invitation: {
            /** @example prj_demo */
            id: string;
            token?: string;
            /** @enum {string} */
            role: "admin" | "designer" | "viewer";
            /** Format: date-time */
            expiresAt: string;
            /** @enum {string} */
            state: "pending" | "accepted" | "revoked" | "expired";
        };
        InvitationAccept: {
            token: string;
        };
        OwnershipTransfer: {
            /** @example prj_demo */
            targetMemberId: string;
            reauthProof: string;
            /** @constant */
            confirm: true;
        };
        Usage: {
            storageBytes: number;
            reservedUploadBytes: number;
            recycleBinBytes: number;
            storageLimitBytes: number;
            projectCount: number;
            projectLimit: number;
            seatCount: number;
            seatLimit: number;
            /** Format: date-time */
            measuredAt: string;
        };
        UploadCreate: {
            filename: string;
            sizeBytes: number;
            /** @enum {string} */
            declaredMime: "image/jpeg" | "image/png";
            /** @example 0000000000000000000000000000000000000000000000000000000000000000 */
            sha256: string;
            folderId?: string | null;
        };
        UploadHeader: {
            name: string;
            value: string;
        };
        /** @description Restricted private write URL for exactly one server allocated object, required MIME/checksum/length. URL is not an asset reference or reusable storage permission. */
        UploadTicket: {
            /** @example prj_demo */
            uploadId: string;
            /** @example prj_demo */
            assetId: string;
            /** @enum {string} */
            method: "PUT" | "POST";
            /** Format: uri */
            url: string;
            headers: components["schemas"]["UploadHeader"][];
            formFields: components["schemas"]["UploadHeader"][];
            /** Format: date-time */
            expiresAt: string;
            maxBytes: number;
        };
        UploadComplete: {
            /** @example prj_demo */
            uploadId: string;
            /** @example 0000000000000000000000000000000000000000000000000000000000000000 */
            sha256: string;
            sizeBytes: number;
        };
        Asset: {
            editorResource?: components["schemas"]["EditorAssetRecord"];
            /** @example prj_demo */
            id: string;
            /** @example prj_demo */
            workspaceId: string;
            originalFilename?: string;
            folderId: string | null;
            /** @enum {string} */
            origin: "upload" | "generated";
            /** @enum {string} */
            state: "pending_upload" | "pending_scan" | "quarantine" | "ready" | "rejected" | "trashed" | "missing" | "deleted";
            /** @example 0000000000000000000000000000000000000000000000000000000000000000 */
            sha256?: string;
            width?: number;
            height?: number;
            sizeBytes?: number;
            revision: number;
            /** Format: date-time */
            createdAt: string;
            /** @example prj_demo */
            provenanceId?: string;
        };
        AssetUpdate: {
            folderId: string | null;
        };
        ResourceReferences: {
            projects: string[];
            activeJobCount: number;
            retentionBlocked: boolean;
        };
        AssetRestore: {
            folderId: string | null;
        };
        /** @description Private signed URL valid at most 300 seconds. Revocation prevents new tokens; previously issued direct URLs can remain usable until expiry. */
        DownloadToken: {
            /** Format: uri */
            url: string;
            /** Format: date-time */
            expiresAt: string;
            filename: string;
            mime: string;
            sizeBytes: number;
            /** @example 0000000000000000000000000000000000000000000000000000000000000000 */
            sha256: string;
        };
        Folder: {
            /** @example prj_demo */
            id: string;
            /** @example prj_demo */
            workspaceId: string;
            parentId: string | null;
            name: string;
            revision: number;
            depth: number;
            /** @enum {string} */
            state: "active" | "trashed";
            /** Format: date-time */
            createdAt: string;
        };
        FolderCreate: {
            parentId: string | null;
            name: string;
        };
        FolderUpdate: {
            parentId?: string | null;
            name?: string;
        };
        FolderRestore: {
            parentId: string | null;
            name?: string;
        };
        AssetExpectedRevision: {
            /** @example prj_demo */
            assetId: string;
            revision: number;
        };
        /** @description All-or-nothing; every asset must have exactly one expected revision and belong to the workspace. Cross-workspace, deleted target, cycle or stale revision rejects entire batch. */
        FolderBatchMove: {
            assetIds: string[];
            targetFolderId: string | null;
            expectedAssets: components["schemas"]["AssetExpectedRevision"][];
        };
        FolderDeletePreview: {
            /** @example prj_demo */
            folderId: string;
            revision: number;
            subfolderCount: number;
            assetCount: number;
            references: components["schemas"]["ResourceReferences"];
            canDelete: boolean;
        };
        Project: {
            /** @example prj_demo */
            id: string;
            /** @example prj_demo */
            workspaceId: string;
            name: string;
            revision: number;
            /** @enum {string} */
            mode: "quick_album" | "full_editor" | "art_to_album";
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
            archived: boolean;
        };
        /** @description Project scene and selected template scene must be compatible, including ink. Resolve templateBindings against immutable typed slots, workspace assets and licenses; missing required placeholders cause422 TEMPLATE_BINDING_REQUIRED atomically before revision1. */
        ProjectCreate: {
            name: string;
            /** @enum {string} */
            mode: "quick_album" | "full_editor" | "art_to_album";
            /** @enum {string} */
            scene: "wedding" | "travel" | "portrait" | "family" | "ink" | "other";
            pageWidthMm: number;
            pageHeightMm: number;
            spreadCount: number;
            /** @example prj_demo */
            templateVersionId?: string;
            /** @description With templateVersionId, must bind every bindingRequired image slot exactly once; unknown/text/duplicate slots rejected. Omit/empty only when template has no required image slots. Without templateVersionId, bindings must be absent/empty. */
            templateBindings?: components["schemas"]["TemplateImageBinding"][];
        };
        ResourceManifestEntry: {
            /** @example prj_demo */
            resourceId: string;
            /** @enum {string} */
            kind: "asset" | "font" | "template" | "filter";
            version: string;
            /** @example 0000000000000000000000000000000000000000000000000000000000000000 */
            sha256: string;
            available: boolean;
            licensed: boolean;
        };
        ProjectDocument: {
            resources?: components["schemas"]["EditorResourceManifest"];
            project: components["schemas"]["Project"];
            document: components["schemas"]["root"];
            manifest: components["schemas"]["ResourceManifestEntry"][];
            /** @example 0000000000000000000000000000000000000000000000000000000000000000 */
            documentSha256: string;
        };
        RevisionSummary: {
            revision: number;
            /** Format: date-time */
            createdAt: string;
            /** @example prj_demo */
            createdBy: string;
            /** @example prj_demo */
            commandId: string;
            /** @example 0000000000000000000000000000000000000000000000000000000000000000 */
            documentSha256: string;
            reason: string;
        };
        ProjectMetadataUpdate: {
            name?: string;
            archived?: boolean;
        };
        /** @description x+width <=1 and y+height <=1. Crop aspect ratio must match frame unless explicit fit mode permits letterboxing. */
        CropRect: {
            x: number;
            y: number;
            width: number;
            height: number;
        };
        SetText: {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "setText";
            /** @example prj_demo */
            spreadId: string;
            /** @example prj_demo */
            layerId: string;
            text: string;
        };
        SetCrop: {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "setCrop";
            /** @example prj_demo */
            spreadId: string;
            /** @example prj_demo */
            layerId: string;
            crop: components["schemas"]["CropRect"];
        };
        ReplaceAsset: {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "replaceAsset";
            /** @example prj_demo */
            spreadId: string;
            /** @example prj_demo */
            layerId: string;
            /** @example prj_demo */
            assetId: string;
        };
        ReorderSpreads: {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "reorderSpreads";
            spreadIds: string[];
        };
        ReplaceDocument: {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "replaceDocument";
            document: components["schemas"]["root"];
        };
        DocumentCommand: components["schemas"]["SetText"] | components["schemas"]["SetCrop"] | components["schemas"]["ReplaceAsset"] | components["schemas"]["ReorderSpreads"] | components["schemas"]["ReplaceDocument"];
        /** @description Atomic command batch, CAS required. replaceDocument is web-only, enabling complete editor saves. Mini allows only template editable text/crop, authorized replacement and spread ordering. Server validates platform from session, never trusts clientPlatform. Unknown same-version layers must survive unchanged; future schema cannot save/export. */
        ProjectPatch: {
            resources?: components["schemas"]["EditorResourceManifest"];
            /** @example prj_demo */
            commandId: string;
            commands: components["schemas"]["DocumentCommand"][];
            /** @enum {string} */
            clientPlatform: "web" | "mini";
        };
        RestoreRevision: {
            sourceRevision: number;
            /** @example prj_demo */
            commandId: string;
        };
        /** @description Published immutable template metadata and typed bindings. Each slot resolves exactly one corresponding layer in its immutable template document; license and resource manifest apply to all placeholder/demo assets and fonts. */
        Template: {
            /** @example prj_demo */
            id: string;
            /** @example prj_demo */
            versionId: string;
            version: number;
            name: string;
            /** @enum {string} */
            scene: "wedding" | "travel" | "portrait" | "family" | "ink" | "other";
            /** @example prj_demo */
            licenseRef: string;
            allowed: boolean;
            widthRatio: number;
            /** @description Same immutable typed slot bindings used by TemplateVersionCreate, not merely a count. */
            slots: components["schemas"]["TemplateSlot"][];
            editableFields: string[];
            manifest: components["schemas"]["ResourceManifestEntry"][];
            /** @description Must equal slots.length. */
            slotCount: number;
        };
        Font: {
            /** @example prj_demo */
            id: string;
            version: string;
            family: string;
            style: string;
            /** @example 0000000000000000000000000000000000000000000000000000000000000000 */
            sha256: string;
            /** @example prj_demo */
            licenseRef: string;
            embeddingAllowed: boolean;
            allowed: boolean;
            glyphCoverage: string[];
        };
        /** @description Only parameters accepted by the immutable renderer recipe schema; no scripts, CSS or expressions. Numeric names/limits are validated by the locked recipe manifest. */
        FilterOperation: {
            /** @enum {string} */
            type: "exposure" | "contrast" | "saturation" | "gamma" | "temperature" | "tint" | "vignette" | "duotone" | "grain";
            parameters: {
                [key: string]: number | string;
            };
        };
        FilterPreset: {
            id: string;
            name: string;
            recipeVersion: number;
            /** @example 0000000000000000000000000000000000000000000000000000000000000000 */
            recipeSha256: string;
            rendererVersion: string;
            operations: components["schemas"]["FilterOperation"][];
            /** @example prj_demo */
            licenseRef: string;
        };
        FilterManifest: {
            version: string;
            /** @example 0000000000000000000000000000000000000000000000000000000000000000 */
            sha256: string;
            /** @constant */
            colorSpace: "srgb";
            /** @constant */
            blendSpace: "linear-light";
            presets: components["schemas"]["FilterPreset"][];
        };
        /** @description layoutSpec is the sole complete layout contract (projectId,baseRevision,photos,constraints,templateRef,algorithmVersion,seed). Its projectId MUST equal route target. Photo dimensions/metadata validated against immutable workspace asset records. No duplicate competing layout model. No implicit paid image generation; returns candidates only. */
        LayoutJobCreate: {
            layoutSpec: components["schemas"]["$defs-root"];
        };
        ConstraintCheck: {
            /** @example prj_demo */
            constraintId: string;
            satisfied: boolean;
            message: string;
        };
        LayoutCandidate: {
            /** @example prj_demo */
            id: string;
            /** @example prj_demo */
            jobId: string;
            baseRevision: number;
            seed: number;
            document: components["schemas"]["root"];
            score: number;
            constraintChecks: components["schemas"]["ConstraintCheck"][];
            /** Format: date-time */
            expiresAt: string;
        };
        ApplyLayout: {
            /** @example prj_demo */
            candidateId: string;
            baseRevision: number;
            /** @example prj_demo */
            commandId: string;
        };
        GenerationPreset: {
            /** @example prj_demo */
            id: string;
            version: number;
            name: string;
            capabilities: ("textToImage" | "imageToImage")[];
            ratios: string[];
            referenceAllowed: boolean;
            commercialAllowed: boolean;
            /** @example prj_demo */
            licenseRef: string;
            /** @example prj_demo */
            policyVersion: string;
            maxPromptCharacters: number;
            seedSupported: boolean;
            available: boolean;
        };
        ReferenceConsent: {
            /** @example prj_demo */
            assetId: string;
            /** @example prj_demo */
            policyVersion: string;
            /** @enum {string} */
            purpose: "imageToImage";
            /** @constant */
            authorized: true;
            /** @constant */
            transferAccepted: true;
        };
        /** @description One billable generation child task per accepted input. imageToImage requires referenceConsent; unsupported adapter parameters rejected rather than ignored. Exact normalized input is hashed into quote; no arbitrary URLs. textSuggestion is not accepted by this image quote/job protocol; optional text suggestions remain unavailable in v1 until a separate typed adapter/quote/settlement protocol is approved. */
        GenerationInput: {
            /** @example prj_demo */
            workspaceId: string;
            /** @example prj_demo */
            presetVersionId: string;
            /** @enum {string} */
            capability: "textToImage" | "imageToImage";
            description: string;
            negativePrompt?: string;
            ratio: string;
            /** @constant */
            imageCount: 1;
            referenceConsent?: components["schemas"]["ReferenceConsent"];
            referenceStrength?: number;
            seed?: number;
        };
        /** @description Server authoritative credit quote; no procurement cost, secrets or real fixture prices exposed. Quote does not reserve credits. Changing input requires new quote. */
        GenerationQuote: {
            /** @example prj_demo */
            id: string;
            /** @example prj_demo */
            workspaceId: string;
            /** @example 0000000000000000000000000000000000000000000000000000000000000000 */
            inputHash: string;
            credits: number;
            /** Format: date-time */
            expiresAt: string;
            /** @example prj_demo */
            configReleaseId: string;
            /** @example prj_demo */
            routeVersionId: string;
            /** @example prj_demo */
            modelVersionId: string;
            /** @example prj_demo */
            presetVersionId: string;
            /** @example prj_demo */
            costRuleVersionId: string;
            /** @example prj_demo */
            policyVersion: string;
            normalizedInput: components["schemas"]["GenerationInput"];
        };
        GenerationJobCreate: {
            /** @example prj_demo */
            quoteId: string;
            /** @example 0000000000000000000000000000000000000000000000000000000000000000 */
            inputHash: string;
            /** @example prj_demo */
            policyConsentVersion: string;
        };
        JobError: {
            code: string;
            message: string;
            retryable: boolean;
        };
        /** @description Every job has a workspaceId. Platform operations use a server-created platform workspace; privacy exports use the actor personal workspace. Public workspace creation cannot create platform workspaces. Platform job access requires corresponding platform permission, never ordinary membership. */
        Job: {
            /** @example prj_demo */
            id: string;
            workspaceId: components["schemas"]["Id"];
            /** @enum {string} */
            kind: "layout" | "generation" | "export" | "privacy_export" | "storage_migration" | "config_test" | "reconciliation" | "backup_restore_drill" | "asset_analysis" | "deletion";
            /** @enum {string} */
            state: "queued" | "running" | "packaging" | "retry_wait" | "cancel_requested" | "succeeded" | "failed" | "cancelled";
            /** @description For generation submission ambiguity state remains running, stage=confirming_upstream and providerSubmissionState=unknown; query frozen upstream request before terminalization. */
            stage: string;
            /** @description Percentage 0–100, matching PostgreSQL jobs.progress; informational only, never proof of terminal success. */
            progress: number;
            revision: number;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
            /** @example prj_demo */
            parentJobId?: string;
            error?: components["schemas"]["JobError"];
            outputIds: string[];
            /** @example prj_demo */
            configReleaseId?: string;
            /** @enum {string} */
            providerSubmissionState: "not_submitted" | "submitting" | "accepted" | "unknown" | "terminal";
        };
        CancelJob: {
            reason?: string;
        };
        RetryJob: {
            expectedRevision: number;
            reason: string;
        };
        Entitlements: {
            /** @example prj_demo */
            workspaceId: string;
            features: string[];
            availableCredits: number;
            reservedCredits: number;
            /** Format: date-time */
            expiresAt?: string;
            storageLimitBytes: number;
            seatLimit: number;
            /** @enum {integer} */
            maxDpi: 72 | 150 | 300;
            watermarkRequired: boolean;
        };
        CreditLedgerEntry: {
            /** @example prj_demo */
            id: string;
            /** @example prj_demo */
            operationId: string;
            /** @enum {string} */
            type: "grant" | "reserve" | "settle" | "release" | "expire" | "refund_adjustment";
            amount: number;
            balanceAfter: number;
            /** @example prj_demo */
            sourceId: string;
            /** Format: date-time */
            createdAt: string;
        };
        Sku: {
            /** @example prj_demo */
            id: string;
            /** @example prj_demo */
            versionId: string;
            name: string;
            priceFen: number;
            /** @constant */
            currency: "CNY";
            durationDays: number;
            creditGrant: number;
            features: string[];
            channels: ("wechat_pay" | "wechat_virtual")[];
            platforms: ("web" | "mini")[];
            /** @enum {string} */
            state: "published" | "retired";
        };
        OrderCreate: {
            /** @example prj_demo */
            workspaceId: string;
            /** @example prj_demo */
            skuVersionId: string;
            /** @enum {string} */
            channel: "wechat_pay" | "wechat_virtual";
            /** @enum {string} */
            clientPlatform: "web" | "mini";
        };
        Order: {
            /** @example prj_demo */
            id: string;
            /** @example prj_demo */
            workspaceId: string;
            /** @example prj_demo */
            skuVersionId: string;
            amountFen: number;
            /** @constant */
            currency: "CNY";
            /** @enum {string} */
            state: "pending" | "paid" | "closed" | "refund_pending" | "partially_refunded" | "refunded";
            /**
             * @description paid+unfulfilled means awaiting fulfillment; fulfilled is one grant transaction, reversed preserves refund reversal, manual_review requires audited finance recovery. Order payment state is independent.
             * @enum {string}
             */
            fulfillmentState: "unfulfilled" | "fulfilled" | "reversed" | "manual_review";
            /** @enum {string} */
            channel: "wechat_pay" | "wechat_virtual";
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            paidAt?: string;
            revision: number;
        };
        PaymentAttemptCreate: {
            /** @enum {string} */
            clientPlatform: "web" | "mini";
            returnPath?: string;
        };
        PaymentQr: {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            kind: "qr";
            qrPayload: string;
        };
        PaymentMini: {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            kind: "mini_jsapi";
            appId: string;
            timeStamp: string;
            nonceStr: string;
            package: string;
            /** @enum {string} */
            signType: "RSA";
            paySign: string;
        };
        VirtualPaymentMini: {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            kind: "mini_virtual";
            offerId: string;
            buyQuantity: number;
            /** @enum {string} */
            env: "production" | "sandbox";
            /** @constant */
            currencyType: "CNY";
            /** @enum {string} */
            platform: "android" | "ios";
            signData: string;
            paySig: string;
            signature: string;
        };
        /** @description Server adapter supplies only documented launch parameters for permitted channel/platform; client launch success never marks order paid. Virtual adapter availability and required SDK fields verified before release; unsupported combinations return CHANNEL_UNAVAILABLE. */
        PaymentLaunch: {
            /** @example prj_demo */
            attemptId: string;
            /** Format: date-time */
            expiresAt: string;
            /** @enum {string} */
            channel: "wechat_pay" | "wechat_virtual";
            launch: components["schemas"]["PaymentQr"] | components["schemas"]["PaymentMini"] | components["schemas"]["VirtualPaymentMini"];
        };
        /** @description Owner billing permission required; actual eligibility determined by consumed credits, source grants and channel policy. No negative credit balance or duplicate grant reversal. */
        RefundCreate: {
            amountFen: number;
            reason: string;
            expectedOrderRevision: number;
        };
        /** @description Canonical database states. Approval authorizes channel submission but is not a persisted terminal state; rejected requests become failed with reasonCode=REFUND_REJECTED and audited decision. Ambiguous upstream refund remains unknown, never duplicate submit; unreconciled cases manual_review. */
        Refund: {
            /** @example prj_demo */
            id: string;
            /** @example prj_demo */
            orderId: string;
            amountFen: number;
            /** @enum {string} */
            state: "requested" | "submitted" | "unknown" | "succeeded" | "failed" | "manual_review";
            reason: string;
            /** Format: date-time */
            createdAt: string;
            revision: number;
            reasonCode: string;
        };
        /** @description Code is sensitive input, must never be logged. Atomic usage/credit grant; generic invalid response and per-user/IP limits prevent code enumeration. */
        RedemptionCreate: {
            /** @example prj_demo */
            workspaceId: string;
            code: string;
        };
        Redemption: {
            /** @example prj_demo */
            id: string;
            /** @example prj_demo */
            workspaceId: string;
            /** @example prj_demo */
            skuVersionId: string;
            creditGrant: number;
            entitlementGrantIds: string[];
            /** Format: date-time */
            redeemedAt: string;
        };
        PreflightRequest: {
            revision: number;
            exportSpec: components["schemas"]["export.schema_$defs-root"];
        };
        PreflightIssue: {
            /** @example prj_demo */
            id: string;
            code: string;
            /** @enum {string} */
            severity: "blocker" | "warning" | "strong_warning";
            message: string;
            /** @example prj_demo */
            spreadId?: string;
            /** @example prj_demo */
            layerId?: string;
            effectivePpi?: number;
            acknowledgementRequired: boolean;
        };
        ExportSurface: {
            /** @example prj_demo */
            id: string;
            pixelWidth: number;
            pixelHeight: number;
            pixelCount: number;
        };
        /** @description Token only when unblocked; binds actor/workspace/project revision/spec hash/manifest/renderer/policy. PPI100–199 warns, <100 strong warning requires explicit issue IDs. Missing original/font/license, overflow/glyph, future schema/unknown render layer, or >50MP surface blocks. */
        PreflightResult: {
            /** @example prj_demo */
            id: string;
            /** @example prj_demo */
            projectId: string;
            revision: number;
            blocked: boolean;
            issues: components["schemas"]["PreflightIssue"][];
            surfaces: components["schemas"]["ExportSurface"][];
            normalizedSpec: components["schemas"]["export.schema_$defs-root"];
            /** @example 0000000000000000000000000000000000000000000000000000000000000000 */
            normalizedSpecHash: string;
            preflightToken?: string;
            /** Format: date-time */
            expiresAt: string;
        };
        /** @description Atomic snapshot, entitlement/quota reservation, job and outbox. Server requires exactly all acknowledgement-required warning IDs and revalidates token, current resource availability, ownership, budgets and expiry. Token cannot be reused with changed spec. */
        ExportJobCreate: {
            /** @example prj_demo */
            workspaceId: string;
            /** @example prj_demo */
            projectId: string;
            revision: number;
            preflightToken: string;
            /** @example 0000000000000000000000000000000000000000000000000000000000000000 */
            normalizedSpecHash: string;
            warningsAcknowledged: string[];
        };
        Output: {
            /** @example prj_demo */
            id: string;
            /** @example prj_demo */
            jobId: string;
            /** @example prj_demo */
            projectId?: string;
            revision?: number;
            /** @enum {string} */
            format: "jpeg" | "png" | "pdf" | "zip" | "json";
            filename: string;
            mime: string;
            sizeBytes: number;
            /** @example 0000000000000000000000000000000000000000000000000000000000000000 */
            sha256: string;
            width?: number;
            height?: number;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            expiresAt: string;
            /** @enum {string} */
            state: "ready" | "expired" | "revoked";
        };
        /** @description passcode required for passcode access mode. Output set remains immutable; share never grants source-photo, edit, or workspace membership rights. */
        ShareCreate: {
            outputIds: string[];
            expiresInHours: number;
            allowDownload: boolean;
            /** @enum {string} */
            accessMode: "link" | "passcode";
            passcode?: string;
        };
        Share: {
            /** @example prj_demo */
            id: string;
            token?: string;
            outputIds: string[];
            /** Format: date-time */
            expiresAt: string;
            allowDownload: boolean;
            /** @enum {string} */
            accessMode: "link" | "passcode";
            revision: number;
            /** @enum {string} */
            state: "active" | "revoked" | "expired";
        };
        ShareAccess: {
            passcode?: string;
        };
        ShareSession: {
            /** @example prj_demo */
            shareId: string;
            shareAccessToken: string;
            /** Format: date-time */
            expiresAt: string;
            outputs: components["schemas"]["Output"][];
            allowDownload: boolean;
        };
        Notification: {
            /** @example prj_demo */
            id: string;
            /** @enum {string} */
            kind: "job_succeeded" | "job_failed" | "payment" | "refund" | "quota" | "security" | "system";
            title: string;
            body: string;
            /** @example prj_demo */
            resourceId?: string;
            read: boolean;
            /** Format: date-time */
            createdAt: string;
        };
        NotificationUpdate: {
            /** @constant */
            read: true;
        };
        NotifySubscription: {
            /** @enum {string} */
            platform: "wechat_mini";
            templateKey: string;
            consentProof: string;
            enabled: boolean;
        };
        PrivacyExportCreate: {
            reauthProof: string;
            includeAssetManifest: boolean;
        };
        ConfigSummary: {
            /** @example prj_demo */
            id: string;
            /** @description Immutable published content/config version when one exists; absent for initial editable draft. revision is independent draft CAS revision. */
            version?: number;
            /** @example prj_demo */
            releaseId?: string;
            /** @enum {string} */
            category: "storage" | "aiConnection" | "auth" | "payment" | "sku" | "editor" | "layout" | "export" | "queue" | "content" | "share" | "notification" | "retention" | "monitor" | "workspace" | "account" | "site" | "upload" | "aiRoute" | "aiPricing" | "albumDefaults";
            /** @enum {string} */
            state: "draft" | "validating" | "tested" | "published" | "retired";
            revision: number;
            /** @example 0000000000000000000000000000000000000000000000000000000000000000 */
            hash: string;
            /** Format: date-time */
            updatedAt: string;
        };
        ConfigDraftCreate: {
            /** @enum {string} */
            category: "storage" | "aiConnection" | "auth" | "payment" | "sku" | "editor" | "layout" | "export" | "queue" | "content" | "share" | "notification" | "retention" | "monitor" | "workspace" | "account" | "site" | "upload" | "aiRoute" | "aiPricing" | "albumDefaults";
            /** @example prj_demo */
            baseReleaseId?: string;
            value: components["schemas"]["config.schema_$defs-root"];
            reason: string;
        };
        ConfigDraft: {
            summary: components["schemas"]["ConfigSummary"];
            value: components["schemas"]["config.schema_$defs-root"];
            validationErrors: components["schemas"]["ErrorDetail"][];
        };
        ConfigDraftUpdate: {
            value: components["schemas"]["config.schema_$defs-root"];
            reason: string;
        };
        PaidTestConfirmation: {
            estimatedMaxCostFen: number;
            /** @constant */
            confirm: true;
            /** @constant */
            budgetSource: "platform_test_budget";
        };
        /** @description level=sample requires explicit bounded cost confirmation. No customer points or originals. Network tests only approved adapter hosts; redirects/DNS/private-address SSRF protections enforced. */
        ConfigTestCreate: {
            /** @enum {string} */
            level: "schema" | "connection" | "storage_roundtrip" | "capability" | "sample";
            /** @example 0000000000000000000000000000000000000000000000000000000000000000 */
            configHash: string;
            credentialVersionIds: string[];
            paidTestConfirmation?: components["schemas"]["PaidTestConfirmation"];
        };
        ConfigTest: {
            /** @example prj_demo */
            id: string;
            /** @example prj_demo */
            draftId: string;
            /** @example 0000000000000000000000000000000000000000000000000000000000000000 */
            configHash: string;
            credentialVersionIds: string[];
            /** @enum {string} */
            level: "schema" | "connection" | "storage_roundtrip" | "capability" | "sample";
            /**
             * @description Explicit API projection: queued/running from associated config_test job; passed/failed/cleanup_required from immutable config_tests result; expired when now>expiresAt or bound hash/secret changed. Expiry never rewrites immutable test result.
             * @enum {string}
             */
            state: "queued" | "running" | "passed" | "failed" | "expired" | "cleanup_required";
            verifiedChecks: string[];
            durationMs?: number;
            error?: components["schemas"]["JobError"];
            /** Format: date-time */
            expiresAt: string;
            /** Format: date-time */
            createdAt: string;
            jobId?: components["schemas"]["Id"];
        } & unknown;
        ConfigChange: {
            path: string;
            effect: string;
            newRequestsOnly: boolean;
            blocking: boolean;
        };
        ConfigImpact: {
            /** @example prj_demo */
            draftId: string;
            /** @example 0000000000000000000000000000000000000000000000000000000000000000 */
            configHash: string;
            changes: components["schemas"]["ConfigChange"][];
            requiredTestLevels: ("schema" | "connection" | "storage_roundtrip" | "capability" | "sample")[];
            readyToPublish: boolean;
        };
        ConfigPublish: {
            /** @example 0000000000000000000000000000000000000000000000000000000000000000 */
            configHash: string;
            testIds: string[];
            reason: string;
        };
        ConfigRelease: {
            /** @example prj_demo */
            id: string;
            version: number;
            /** @example 0000000000000000000000000000000000000000000000000000000000000000 */
            configHash: string;
            draftIds: string[];
            /** Format: date-time */
            publishedAt: string;
            /** @example prj_demo */
            publishedBy: string;
            reason: string;
            /** @example prj_demo */
            previousReleaseId?: string;
        };
        /** @description Republish validated old configuration as a new release. Must re-test current secret validity and dependencies; no ledger/object/task history reversal. */
        ConfigRollback: {
            /** @example prj_demo */
            sourceReleaseId: string;
            testIds: string[];
            reason: string;
        };
        EmergencyDisable: {
            capability: string;
            disabled: boolean;
            reason: string;
        };
        /** @description Write-only secret. HTTPS; input excluded from logs/traces; dedicated secrets permission and step-up authentication. Never returned or placed in config exports. */
        SecretCreate: {
            /** @enum {string} */
            purpose: "storage_read" | "storage_write" | "storage_cleanup" | "ai" | "wechat" | "payment" | "notify";
            value: string;
            reason: string;
        };
        SecretMetadata: {
            /** @example prj_demo */
            id: string;
            /** @example prj_demo */
            versionId: string;
            maskedHint: string;
            purpose: string;
            /** @enum {string} */
            state: "pending" | "active" | "revoked" | "expired";
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            lastValidatedAt?: string;
            /** Format: date-time */
            expiresAt?: string;
        };
        SecretRotate: {
            value: string;
            reason: string;
        };
        /** @description Normal revocation rejected while active snapshot/provider query pins exist. Emergency explicit revocation is audited and prevents unsafe resubmission. */
        SecretRevoke: {
            reason: string;
            emergency: boolean;
        };
        AuditEvent: {
            /** @example prj_demo */
            id: string;
            /** @example prj_demo */
            actorId: string;
            action: string;
            targetType: string;
            /** @example prj_demo */
            targetId: string;
            reason?: string;
            /** @example prj_demo */
            requestId: string;
            /** Format: date-time */
            occurredAt: string;
            /** @example 0000000000000000000000000000000000000000000000000000000000000000 */
            beforeHash?: string;
            /** @example 0000000000000000000000000000000000000000000000000000000000000000 */
            afterHash?: string;
        };
        StorageProfileUsage: {
            /** @example prj_demo */
            profileId: string;
            version: number;
            objectCount: number;
            bytes: number;
            activePins: number;
            canRetire: boolean;
            /** @enum {string} */
            state: "active_write" | "read_only" | "retired";
        };
        StoragePathPreview: {
            /** @example prj_demo */
            profileVersionId: string;
            /** @example prj_demo */
            workspaceId: string;
            /** @enum {string} */
            kind: "original" | "normalized" | "preview" | "document" | "font" | "template" | "generated" | "export" | "temporary";
            /** @example prj_demo */
            resourceId: string;
            /** @example 0000000000000000000000000000000000000000000000000000000000000000 */
            sha256: string;
            /** @enum {string} */
            extension: "jpg" | "png" | "pdf" | "json" | "woff2" | "zip";
        };
        StoragePathResult: {
            relativeKey: string;
            /** @example prj_demo */
            profileVersionId: string;
            /** @constant */
            newWritesOnly: true;
        };
        /** @description Empty workspaceIds means entire approved platform scope and requires platform.storage.migrate_all. Target must be validated in same deployment environment. Cross-region requires data-location policy approval. */
        MigrationPlanCreate: {
            /** @example prj_demo */
            sourceProfileVersionId: string;
            /** @example prj_demo */
            targetProfileVersionId: string;
            workspaceIds: string[];
            kinds: ("original" | "normalized" | "preview" | "document" | "font" | "template" | "generated" | "export")[];
            reason: string;
        };
        MigrationPlan: {
            /** @example prj_demo */
            id: string;
            /** @example 0000000000000000000000000000000000000000000000000000000000000000 */
            planHash: string;
            objectCount: number;
            bytes: number;
            estimatedMaxCostFen: number;
            activePins: number;
            blockers: string[];
            /** Format: date-time */
            expiresAt: string;
        };
        /** @description Copy, verify size/SHA, CAS locator, retain old copy/pinned snapshots, reconcile references then retention cleanup. Per-object checkpoint retry; never prefix string substitution. */
        MigrationStart: {
            /** @example prj_demo */
            planId: string;
            /** @example 0000000000000000000000000000000000000000000000000000000000000000 */
            planHash: string;
            approvedMaxCostFen: number;
            /** @constant */
            confirm: true;
        };
        ReadinessCheck: {
            capability: string;
            /** @enum {string} */
            state: "ready" | "blocked" | "degraded" | "unconfigured";
            checkIds: string[];
            /** Format: date-time */
            lastVerifiedAt?: string;
            reasonCode: string;
        };
        OperationsStatus: {
            /** @enum {string} */
            environment: "dev" | "staging" | "prod";
            checks: components["schemas"]["ReadinessCheck"][];
            queueLagSeconds: number;
            outboxUnsentCount: number;
            /** Format: date-time */
            backupLastSuccessAt?: string;
            /** Format: date-time */
            checkedAt: string;
        };
        /** @description Read/reconcile via authorized adapters; repairs use unique accounting operations and CAS, never overwrite terminal job state or grant manually. */
        ReconcileRequest: {
            /** @enum {string} */
            scope: "payments" | "refunds" | "credits" | "provider_costs" | "outbox" | "job_results" | "storage_references";
            /** Format: date-time */
            from: string;
            /** Format: date-time */
            to: string;
            /** @example prj_demo */
            workspaceId?: string;
            reason: string;
        };
        ReconcileResult: {
            /** @example prj_demo */
            id: string;
            scope: string;
            scannedCount: number;
            discrepancyCount: number;
            /** @example prj_demo */
            repairJobId?: string;
            /** @enum {string} */
            state: "queued" | "running" | "completed" | "failed";
            /** @example prj_demo */
            reportOutputId?: string;
        };
        /** @description Restore verification only into isolated nonproduction resources; no production credential, deployment, or destructive action authorized by this design endpoint. */
        BackupDrillCreate: {
            /** @example prj_demo */
            backupId: string;
            /** @constant */
            target: "isolated_ephemeral";
            includeObjects: boolean;
            reason: string;
        };
        AdminDecision: {
            expectedRevision: number;
            /** @enum {string} */
            decision: "approve" | "reject";
            reason: string;
        };
        RedemptionBatchCreate: {
            /** @example prj_demo */
            skuVersionId: string;
            count: number;
            maxUsesPerCode: number;
            /** Format: date-time */
            expiresAt: string;
            reason: string;
        };
        /** @description Batch metadata only. Never contains raw codes. Legacy codeDownloadOutputId is optional and is not synthesized by creation. */
        RedemptionBatch: {
            /** @example prj_demo */
            id: string;
            /** @example prj_demo */
            skuVersionId: string;
            count: number;
            /** Format: date-time */
            expiresAt: string;
            /** @enum {string} */
            state: "active" | "disabled" | "expired";
            revision: number;
            /** @example prj_demo */
            codeDownloadOutputId?: string;
        };
        /** @description Creation-only metadata. oneTimeCodes is present only on the first generating response; replay omits it. Raw codes are never persisted, logged, listed or returned again. The authorized admin must immediately download the transient response; lost responses require explicit disable and reissue. */
        RedemptionBatchCreated: {
            /** @example prj_demo */
            id: string;
            /** @example prj_demo */
            skuVersionId: string;
            count: number;
            /** Format: date-time */
            expiresAt: string;
            /** @enum {string} */
            state: "active" | "disabled" | "expired";
            revision: number;
            oneTimeCodes?: string[];
            /** @example prj_demo */
            codeDownloadOutputId?: string;
        };
        ContentPublication: {
            /** @enum {string} */
            kind: "template" | "font" | "preset" | "sku" | "filter_manifest";
            /** @example prj_demo */
            versionId: string;
            /** @example prj_demo */
            licenseRef: string;
            reviewEvidenceIds: string[];
            reason: string;
        };
        ContentVersion: {
            /** @example prj_demo */
            id: string;
            /** @enum {string} */
            kind: "template" | "font" | "preset" | "sku" | "filter_manifest";
            /** @enum {string} */
            state: "draft" | "review" | "published" | "retired";
            version: number;
            /** @example prj_demo */
            licenseRef: string;
            /** Format: date-time */
            createdAt: string;
            revision: number;
        };
        ContentRetire: {
            reason: string;
            blockNewUse: boolean;
        };
        ProviderCallbackReceipt: {
            /** @example prj_demo */
            eventId: string;
            /** @constant */
            accepted: true;
            duplicate: boolean;
        };
        /** @description No arbitrary set-state or manual success. Unknown upstream triggers query by frozen providerRequestId; repeat paid submit is forbidden. */
        AdminJobAction: {
            expectedRevision: number;
            /** @enum {string} */
            action: "request_cancel" | "reconcile_upstream" | "reschedule_dispatch";
            reason: string;
        };
        QueryFilters: {
            /** @example prj_demo */
            workspaceId?: string;
            state?: string;
            kind?: string;
            /** Format: date-time */
            from?: string;
            /** Format: date-time */
            to?: string;
        };
        GetCapabilitiesResponse: {
            data: components["schemas"]["Capabilities"];
            /** @example prj_demo */
            requestId: string;
        };
        LoginWechatMiniResponse: {
            data: components["schemas"]["MiniSession"];
            /** @example prj_demo */
            requestId: string;
        };
        CreateSmsChallengeResponse: {
            data: components["schemas"]["SmsChallenge"];
            /** @example prj_demo */
            requestId: string;
        };
        LoginSmsWebResponse: {
            data: components["schemas"]["WebSession"];
            /** @example prj_demo */
            requestId: string;
        };
        CreateQrSessionResponse: {
            data: components["schemas"]["QrSession"];
            /** @example prj_demo */
            requestId: string;
        };
        PollQrSessionResponse: {
            data: components["schemas"]["QrStatus"];
            /** @example prj_demo */
            requestId: string;
        };
        ConfirmQrSessionResponse: {
            data: components["schemas"]["QrStatus"];
            /** @example prj_demo */
            requestId: string;
        };
        ConsumeQrSessionResponse: {
            data: components["schemas"]["WebSession"];
            /** @example prj_demo */
            requestId: string;
        };
        RefreshMiniSessionResponse: {
            data: components["schemas"]["MiniSession"];
            /** @example prj_demo */
            requestId: string;
        };
        GetWebSessionResponse: {
            data: components["schemas"]["WebSession"];
            /** @example prj_demo */
            requestId: string;
        };
        LogoutSessionResponse: {
            data: components["schemas"]["Accepted"];
            /** @example prj_demo */
            requestId: string;
        };
        ListSessionsPage: {
            items: components["schemas"]["Session"][];
            nextCursor: string | null;
            hasMore: boolean;
        };
        ListSessionsResponse: {
            data: components["schemas"]["ListSessionsPage"];
            /** @example prj_demo */
            requestId: string;
        };
        RevokeSessionResponse: {
            data: components["schemas"]["Accepted"];
            /** @example prj_demo */
            requestId: string;
        };
        GetMeResponse: {
            data: components["schemas"]["User"];
            /** @example prj_demo */
            requestId: string;
        };
        ListBindingsPage: {
            items: components["schemas"]["Binding"][];
            nextCursor: string | null;
            hasMore: boolean;
        };
        ListBindingsResponse: {
            data: components["schemas"]["ListBindingsPage"];
            /** @example prj_demo */
            requestId: string;
        };
        CreateBindingResponse: {
            data: components["schemas"]["Binding"];
            /** @example prj_demo */
            requestId: string;
        };
        DeleteBindingResponse: {
            data: components["schemas"]["Accepted"];
            /** @example prj_demo */
            requestId: string;
        };
        RequestAccountDeletionResponse: {
            data: components["schemas"]["DeletionStatus"];
            /** @example prj_demo */
            requestId: string;
        };
        GetAccountDeletionResponse: {
            data: components["schemas"]["DeletionStatus"];
            /** @example prj_demo */
            requestId: string;
        };
        CancelAccountDeletionResponse: {
            data: components["schemas"]["DeletionStatus"];
            /** @example prj_demo */
            requestId: string;
        };
        CreatePrivacyExportResponse: {
            data: components["schemas"]["Job"];
            /** @example prj_demo */
            requestId: string;
        };
        GetPreferencesResponse: {
            data: components["schemas"]["Preferences"];
            /** @example prj_demo */
            requestId: string;
        };
        UpdatePreferencesResponse: {
            data: components["schemas"]["Preferences"];
            /** @example prj_demo */
            requestId: string;
        };
        ListWorkspacesPage: {
            items: components["schemas"]["Workspace"][];
            nextCursor: string | null;
            hasMore: boolean;
        };
        ListWorkspacesResponse: {
            data: components["schemas"]["ListWorkspacesPage"];
            /** @example prj_demo */
            requestId: string;
        };
        CreateWorkspaceResponse: {
            data: components["schemas"]["Workspace"];
            /** @example prj_demo */
            requestId: string;
        };
        GetWorkspaceResponse: {
            data: components["schemas"]["Workspace"];
            /** @example prj_demo */
            requestId: string;
        };
        UpdateWorkspaceResponse: {
            data: components["schemas"]["Workspace"];
            /** @example prj_demo */
            requestId: string;
        };
        ListMembersPage: {
            items: components["schemas"]["Member"][];
            nextCursor: string | null;
            hasMore: boolean;
        };
        ListMembersResponse: {
            data: components["schemas"]["ListMembersPage"];
            /** @example prj_demo */
            requestId: string;
        };
        UpdateMemberResponse: {
            data: components["schemas"]["Member"];
            /** @example prj_demo */
            requestId: string;
        };
        RemoveMemberResponse: {
            data: components["schemas"]["Accepted"];
            /** @example prj_demo */
            requestId: string;
        };
        CreateInvitationResponse: {
            data: components["schemas"]["Invitation"];
            /** @example prj_demo */
            requestId: string;
        };
        AcceptInvitationResponse: {
            data: components["schemas"]["Workspace"];
            /** @example prj_demo */
            requestId: string;
        };
        RevokeInvitationResponse: {
            data: components["schemas"]["Accepted"];
            /** @example prj_demo */
            requestId: string;
        };
        TransferOwnershipResponse: {
            data: components["schemas"]["Workspace"];
            /** @example prj_demo */
            requestId: string;
        };
        GetWorkspaceUsageResponse: {
            data: components["schemas"]["Usage"];
            /** @example prj_demo */
            requestId: string;
        };
        CreateUploadResponse: {
            data: components["schemas"]["UploadTicket"];
            /** @example prj_demo */
            requestId: string;
        };
        CompleteUploadResponse: {
            data: components["schemas"]["Asset"];
            /** @example prj_demo */
            requestId: string;
        };
        ListAssetsPage: {
            items: components["schemas"]["Asset"][];
            nextCursor: string | null;
            hasMore: boolean;
        };
        ListAssetsResponse: {
            data: components["schemas"]["ListAssetsPage"];
            /** @example prj_demo */
            requestId: string;
        };
        GetAssetResponse: {
            data: components["schemas"]["Asset"];
            /** @example prj_demo */
            requestId: string;
        };
        MoveAssetResponse: {
            data: components["schemas"]["Asset"];
            /** @example prj_demo */
            requestId: string;
        };
        GetAssetReferencesResponse: {
            data: components["schemas"]["ResourceReferences"];
            /** @example prj_demo */
            requestId: string;
        };
        TrashAssetResponse: {
            data: components["schemas"]["Accepted"];
            /** @example prj_demo */
            requestId: string;
        };
        RestoreAssetResponse: {
            data: components["schemas"]["Asset"];
            /** @example prj_demo */
            requestId: string;
        };
        CreateAssetDownloadTokenResponse: {
            data: components["schemas"]["DownloadToken"];
            /** @example prj_demo */
            requestId: string;
        };
        ListFoldersPage: {
            items: components["schemas"]["Folder"][];
            nextCursor: string | null;
            hasMore: boolean;
        };
        ListFoldersResponse: {
            data: components["schemas"]["ListFoldersPage"];
            /** @example prj_demo */
            requestId: string;
        };
        CreateFolderResponse: {
            data: components["schemas"]["Folder"];
            /** @example prj_demo */
            requestId: string;
        };
        GetFolderResponse: {
            data: components["schemas"]["Folder"];
            /** @example prj_demo */
            requestId: string;
        };
        UpdateFolderResponse: {
            data: components["schemas"]["Folder"];
            /** @example prj_demo */
            requestId: string;
        };
        PreviewFolderDeleteResponse: {
            data: components["schemas"]["FolderDeletePreview"];
            /** @example prj_demo */
            requestId: string;
        };
        TrashFolderResponse: {
            data: components["schemas"]["Accepted"];
            /** @example prj_demo */
            requestId: string;
        };
        RestoreFolderResponse: {
            data: components["schemas"]["Folder"];
            /** @example prj_demo */
            requestId: string;
        };
        BatchMoveAssetsResponse: {
            data: components["schemas"]["Accepted"];
            /** @example prj_demo */
            requestId: string;
        };
        ListProjectsPage: {
            items: components["schemas"]["Project"][];
            nextCursor: string | null;
            hasMore: boolean;
        };
        ListProjectsResponse: {
            data: components["schemas"]["ListProjectsPage"];
            /** @example prj_demo */
            requestId: string;
        };
        CreateProjectResponse: {
            data: components["schemas"]["ProjectDocument"];
            /** @example prj_demo */
            requestId: string;
        };
        GetProjectResponse: {
            data: components["schemas"]["ProjectDocument"];
            /** @example prj_demo */
            requestId: string;
        };
        PatchProjectResponse: {
            data: components["schemas"]["ProjectDocument"];
            /** @example prj_demo */
            requestId: string;
        };
        UpdateProjectMetadataResponse: {
            data: components["schemas"]["Project"];
            /** @example prj_demo */
            requestId: string;
        };
        ListProjectRevisionsPage: {
            items: components["schemas"]["RevisionSummary"][];
            nextCursor: string | null;
            hasMore: boolean;
        };
        ListProjectRevisionsResponse: {
            data: components["schemas"]["ListProjectRevisionsPage"];
            /** @example prj_demo */
            requestId: string;
        };
        RestoreProjectRevisionResponse: {
            data: components["schemas"]["ProjectDocument"];
            /** @example prj_demo */
            requestId: string;
        };
        TrashProjectResponse: {
            data: components["schemas"]["Accepted"];
            /** @example prj_demo */
            requestId: string;
        };
        ListTemplatesPage: {
            items: components["schemas"]["Template"][];
            nextCursor: string | null;
            hasMore: boolean;
        };
        ListTemplatesResponse: {
            data: components["schemas"]["ListTemplatesPage"];
            /** @example prj_demo */
            requestId: string;
        };
        GetTemplateResponse: {
            data: components["schemas"]["Template"];
            /** @example prj_demo */
            requestId: string;
        };
        ListFontsPage: {
            items: components["schemas"]["Font"][];
            nextCursor: string | null;
            hasMore: boolean;
        };
        ListFontsResponse: {
            data: components["schemas"]["ListFontsPage"];
            /** @example prj_demo */
            requestId: string;
        };
        GetFontResponse: {
            data: components["schemas"]["Font"];
            /** @example prj_demo */
            requestId: string;
        };
        CreateFontDownloadTokenResponse: {
            data: components["schemas"]["DownloadToken"];
            /** @example prj_demo */
            requestId: string;
        };
        GetFilterManifestResponse: {
            data: components["schemas"]["FilterManifest"];
            /** @example prj_demo */
            requestId: string;
        };
        CreateLayoutJobResponse: {
            data: components["schemas"]["Job"];
            /** @example prj_demo */
            requestId: string;
        };
        ListLayoutCandidatesPage: {
            items: components["schemas"]["LayoutCandidate"][];
            nextCursor: string | null;
            hasMore: boolean;
        };
        ListLayoutCandidatesResponse: {
            data: components["schemas"]["ListLayoutCandidatesPage"];
            /** @example prj_demo */
            requestId: string;
        };
        ApplyLayoutResponse: {
            data: components["schemas"]["ProjectDocument"];
            /** @example prj_demo */
            requestId: string;
        };
        ListGenerationPresetsPage: {
            items: components["schemas"]["GenerationPreset"][];
            nextCursor: string | null;
            hasMore: boolean;
        };
        ListGenerationPresetsResponse: {
            data: components["schemas"]["ListGenerationPresetsPage"];
            /** @example prj_demo */
            requestId: string;
        };
        CreateGenerationQuoteResponse: {
            data: components["schemas"]["GenerationQuote"];
            /** @example prj_demo */
            requestId: string;
        };
        GetGenerationQuoteResponse: {
            data: components["schemas"]["GenerationQuote"];
            /** @example prj_demo */
            requestId: string;
        };
        CreateGenerationJobResponse: {
            data: components["schemas"]["Job"];
            /** @example prj_demo */
            requestId: string;
        };
        ListWorkspaceJobsPage: {
            items: components["schemas"]["Job"][];
            nextCursor: string | null;
            hasMore: boolean;
        };
        ListWorkspaceJobsResponse: {
            data: components["schemas"]["ListWorkspaceJobsPage"];
            /** @example prj_demo */
            requestId: string;
        };
        GetJobResponse: {
            data: components["schemas"]["Job"];
            /** @example prj_demo */
            requestId: string;
        };
        CancelJobResponse: {
            data: components["schemas"]["Job"];
            /** @example prj_demo */
            requestId: string;
        };
        RetryJobResponse: {
            data: components["schemas"]["Job"];
            /** @example prj_demo */
            requestId: string;
        };
        GetEntitlementsResponse: {
            data: components["schemas"]["Entitlements"];
            /** @example prj_demo */
            requestId: string;
        };
        ListCreditLedgerPage: {
            items: components["schemas"]["CreditLedgerEntry"][];
            nextCursor: string | null;
            hasMore: boolean;
        };
        ListCreditLedgerResponse: {
            data: components["schemas"]["ListCreditLedgerPage"];
            /** @example prj_demo */
            requestId: string;
        };
        ListSkusPage: {
            items: components["schemas"]["Sku"][];
            nextCursor: string | null;
            hasMore: boolean;
        };
        ListSkusResponse: {
            data: components["schemas"]["ListSkusPage"];
            /** @example prj_demo */
            requestId: string;
        };
        CreateOrderResponse: {
            data: components["schemas"]["Order"];
            /** @example prj_demo */
            requestId: string;
        };
        ListOrdersPage: {
            items: components["schemas"]["Order"][];
            nextCursor: string | null;
            hasMore: boolean;
        };
        ListOrdersResponse: {
            data: components["schemas"]["ListOrdersPage"];
            /** @example prj_demo */
            requestId: string;
        };
        GetOrderResponse: {
            data: components["schemas"]["Order"];
            /** @example prj_demo */
            requestId: string;
        };
        CreatePaymentAttemptResponse: {
            data: components["schemas"]["PaymentLaunch"];
            /** @example prj_demo */
            requestId: string;
        };
        CloseOrderResponse: {
            data: components["schemas"]["Order"];
            /** @example prj_demo */
            requestId: string;
        };
        RequestRefundResponse: {
            data: components["schemas"]["Refund"];
            /** @example prj_demo */
            requestId: string;
        };
        GetRefundResponse: {
            data: components["schemas"]["Refund"];
            /** @example prj_demo */
            requestId: string;
        };
        RedeemCodeResponse: {
            data: components["schemas"]["Redemption"];
            /** @example prj_demo */
            requestId: string;
        };
        ListRedemptionsPage: {
            items: components["schemas"]["Redemption"][];
            nextCursor: string | null;
            hasMore: boolean;
        };
        ListRedemptionsResponse: {
            data: components["schemas"]["ListRedemptionsPage"];
            /** @example prj_demo */
            requestId: string;
        };
        CreatePreflightResponse: {
            data: components["schemas"]["PreflightResult"];
            /** @example prj_demo */
            requestId: string;
        };
        CreateExportJobResponse: {
            data: components["schemas"]["Job"];
            /** @example prj_demo */
            requestId: string;
        };
        ListJobOutputsPage: {
            items: components["schemas"]["Output"][];
            nextCursor: string | null;
            hasMore: boolean;
        };
        ListJobOutputsResponse: {
            data: components["schemas"]["ListJobOutputsPage"];
            /** @example prj_demo */
            requestId: string;
        };
        GetOutputResponse: {
            data: components["schemas"]["Output"];
            /** @example prj_demo */
            requestId: string;
        };
        CreateOutputDownloadTokenResponse: {
            data: components["schemas"]["DownloadToken"];
            /** @example prj_demo */
            requestId: string;
        };
        CreateShareResponse: {
            data: components["schemas"]["Share"];
            /** @example prj_demo */
            requestId: string;
        };
        ListSharesPage: {
            items: components["schemas"]["Share"][];
            nextCursor: string | null;
            hasMore: boolean;
        };
        ListSharesResponse: {
            data: components["schemas"]["ListSharesPage"];
            /** @example prj_demo */
            requestId: string;
        };
        GetShareResponse: {
            data: components["schemas"]["Share"];
            /** @example prj_demo */
            requestId: string;
        };
        RevokeShareResponse: {
            data: components["schemas"]["Share"];
            /** @example prj_demo */
            requestId: string;
        };
        AccessPublicShareResponse: {
            data: components["schemas"]["ShareSession"];
            /** @example prj_demo */
            requestId: string;
        };
        CreateSharedDownloadTokenResponse: {
            data: components["schemas"]["DownloadToken"];
            /** @example prj_demo */
            requestId: string;
        };
        ListNotificationsPage: {
            items: components["schemas"]["Notification"][];
            nextCursor: string | null;
            hasMore: boolean;
        };
        ListNotificationsResponse: {
            data: components["schemas"]["ListNotificationsPage"];
            /** @example prj_demo */
            requestId: string;
        };
        MarkNotificationReadResponse: {
            data: components["schemas"]["Notification"];
            /** @example prj_demo */
            requestId: string;
        };
        SetNotificationSubscriptionResponse: {
            data: components["schemas"]["Accepted"];
            /** @example prj_demo */
            requestId: string;
        };
        ListConfigDraftsPage: {
            items: components["schemas"]["ConfigSummary"][];
            nextCursor: string | null;
            hasMore: boolean;
        };
        ListConfigDraftsResponse: {
            data: components["schemas"]["ListConfigDraftsPage"];
            /** @example prj_demo */
            requestId: string;
        };
        CreateConfigDraftResponse: {
            data: components["schemas"]["ConfigDraft"];
            /** @example prj_demo */
            requestId: string;
        };
        GetConfigDraftResponse: {
            data: components["schemas"]["ConfigDraft"];
            /** @example prj_demo */
            requestId: string;
        };
        ReplaceConfigDraftResponse: {
            data: components["schemas"]["ConfigDraft"];
            /** @example prj_demo */
            requestId: string;
        };
        DiscardConfigDraftResponse: {
            data: components["schemas"]["Accepted"];
            /** @example prj_demo */
            requestId: string;
        };
        CreateConfigTestResponse: {
            data: components["schemas"]["ConfigTest"];
            /** @example prj_demo */
            requestId: string;
        };
        GetConfigTestResponse: {
            data: components["schemas"]["ConfigTest"];
            /** @example prj_demo */
            requestId: string;
        };
        GetConfigImpactResponse: {
            data: components["schemas"]["ConfigImpact"];
            /** @example prj_demo */
            requestId: string;
        };
        PublishConfigResponse: {
            data: components["schemas"]["ConfigRelease"];
            /** @example prj_demo */
            requestId: string;
        };
        ListConfigReleasesPage: {
            items: components["schemas"]["ConfigRelease"][];
            nextCursor: string | null;
            hasMore: boolean;
        };
        ListConfigReleasesResponse: {
            data: components["schemas"]["ListConfigReleasesPage"];
            /** @example prj_demo */
            requestId: string;
        };
        GetConfigReleaseResponse: {
            data: components["schemas"]["ConfigRelease"];
            /** @example prj_demo */
            requestId: string;
        };
        RollbackConfigResponse: {
            data: components["schemas"]["ConfigRelease"];
            /** @example prj_demo */
            requestId: string;
        };
        EmergencyDisableCapabilityResponse: {
            data: components["schemas"]["Accepted"];
            /** @example prj_demo */
            requestId: string;
        };
        ListSecretMetadataPage: {
            items: components["schemas"]["SecretMetadata"][];
            nextCursor: string | null;
            hasMore: boolean;
        };
        ListSecretMetadataResponse: {
            data: components["schemas"]["ListSecretMetadataPage"];
            /** @example prj_demo */
            requestId: string;
        };
        CreateSecretResponse: {
            data: components["schemas"]["SecretMetadata"];
            /** @example prj_demo */
            requestId: string;
        };
        RotateSecretResponse: {
            data: components["schemas"]["SecretMetadata"];
            /** @example prj_demo */
            requestId: string;
        };
        RevokeSecretResponse: {
            data: components["schemas"]["SecretMetadata"];
            /** @example prj_demo */
            requestId: string;
        };
        ListProviderContractsResponse: {
            data: components["schemas"]["ProviderContractPage"];
            /** @example prj_demo */
            requestId: string;
        };
        ListStorageProfilesUsagePage: {
            items: components["schemas"]["StorageProfileUsage"][];
            nextCursor: string | null;
            hasMore: boolean;
        };
        ListStorageProfilesUsageResponse: {
            data: components["schemas"]["ListStorageProfilesUsagePage"];
            /** @example prj_demo */
            requestId: string;
        };
        PreviewStoragePathResponse: {
            data: components["schemas"]["StoragePathResult"];
            /** @example prj_demo */
            requestId: string;
        };
        PlanStorageMigrationResponse: {
            data: components["schemas"]["MigrationPlan"];
            /** @example prj_demo */
            requestId: string;
        };
        StartStorageMigrationResponse: {
            data: components["schemas"]["Job"];
            /** @example prj_demo */
            requestId: string;
        };
        GetStorageMigrationResponse: {
            data: components["schemas"]["Job"];
            /** @example prj_demo */
            requestId: string;
        };
        PublishContentVersionResponse: {
            data: components["schemas"]["ContentVersion"];
            /** @example prj_demo */
            requestId: string;
        };
        RetireContentVersionResponse: {
            data: components["schemas"]["ContentVersion"];
            /** @example prj_demo */
            requestId: string;
        };
        DecideRefundResponse: {
            data: components["schemas"]["Refund"];
            /** @example prj_demo */
            requestId: string;
        };
        CreateRedemptionBatchResponse: {
            data: components["schemas"]["RedemptionBatchCreated"];
            /** @example prj_demo */
            requestId: string;
        };
        ListRedemptionBatchesPage: {
            items: components["schemas"]["RedemptionBatch"][];
            nextCursor: string | null;
            hasMore: boolean;
        };
        ListRedemptionBatchesResponse: {
            data: components["schemas"]["ListRedemptionBatchesPage"];
            /** @example prj_demo */
            requestId: string;
        };
        DisableRedemptionBatchResponse: {
            data: components["schemas"]["RedemptionBatch"];
            /** @example prj_demo */
            requestId: string;
        };
        ListAuditEventsPage: {
            items: components["schemas"]["AuditEvent"][];
            nextCursor: string | null;
            hasMore: boolean;
        };
        ListAuditEventsResponse: {
            data: components["schemas"]["ListAuditEventsPage"];
            /** @example prj_demo */
            requestId: string;
        };
        QueryAdminJobsPage: {
            items: components["schemas"]["Job"][];
            nextCursor: string | null;
            hasMore: boolean;
        };
        QueryAdminJobsResponse: {
            data: components["schemas"]["QueryAdminJobsPage"];
            /** @example prj_demo */
            requestId: string;
        };
        AdminJobActionResponse: {
            data: components["schemas"]["Job"];
            /** @example prj_demo */
            requestId: string;
        };
        QueryAdminOrdersPage: {
            items: components["schemas"]["Order"][];
            nextCursor: string | null;
            hasMore: boolean;
        };
        QueryAdminOrdersResponse: {
            data: components["schemas"]["QueryAdminOrdersPage"];
            /** @example prj_demo */
            requestId: string;
        };
        QueryAdminRefundsPage: {
            items: components["schemas"]["Refund"][];
            nextCursor: string | null;
            hasMore: boolean;
        };
        QueryAdminRefundsResponse: {
            data: components["schemas"]["QueryAdminRefundsPage"];
            /** @example prj_demo */
            requestId: string;
        };
        GetOperationsStatusResponse: {
            data: components["schemas"]["OperationsStatus"];
            /** @example prj_demo */
            requestId: string;
        };
        StartReconciliationResponse: {
            data: components["schemas"]["ReconcileResult"];
            /** @example prj_demo */
            requestId: string;
        };
        GetReconciliationResponse: {
            data: components["schemas"]["ReconcileResult"];
            /** @example prj_demo */
            requestId: string;
        };
        CreateBackupRestoreDrillResponse: {
            data: components["schemas"]["Job"];
            /** @example prj_demo */
            requestId: string;
        };
        ReceivePaymentCallbackResponse: {
            data: components["schemas"]["ProviderCallbackReceipt"];
            /** @example prj_demo */
            requestId: string;
        };
        CallbackAck: {
            /** @enum {string} */
            code: "SUCCESS";
            message?: string;
        };
        ReceiveRefundCallbackResponse: {
            data: components["schemas"]["ProviderCallbackReceipt"];
            /** @example prj_demo */
            requestId: string;
        };
        ReceiveProviderCallbackResponse: {
            data: components["schemas"]["ProviderCallbackReceipt"];
            /** @example prj_demo */
            requestId: string;
        };
        ReceiveNotificationCallbackResponse: {
            data: components["schemas"]["ProviderCallbackReceipt"];
            /** @example prj_demo */
            requestId: string;
        };
        ReauthenticateRequest: {
            proof: components["schemas"]["IdentityProof"];
            /** @enum {string} */
            purpose: "bind" | "unbind" | "delete_account" | "privacy_export" | "ownership_transfer" | "billing_refund" | "admin_secret" | "admin_publish" | "admin_operations";
        };
        /** @description Single-purpose proof bound to actor+session, fresh identity verification and current admin privilege; expires within5 minutes; sensitive action consumes it with idempotent replay protection. */
        ReauthenticationResult: {
            reauthProof: string;
            purpose: string;
            /** Format: date-time */
            expiresAt: string;
        };
        ReauthenticateResponse: {
            data: components["schemas"]["ReauthenticationResult"];
            /** @example prj_demo */
            requestId: string;
        };
        RestoreProjectResponse: {
            data: components["schemas"]["Project"];
            /** @example prj_demo */
            requestId: string;
        };
        LiveStatus: {
            /** @enum {string} */
            status: "alive";
            /** Format: date-time */
            time: string;
        };
        DependencyReadyStatus: {
            /** @enum {string} */
            dependency: "database" | "queue_dispatch" | "config";
            /** @enum {string} */
            state: "ready" | "failed" | "not_required";
        };
        ReadyStatus: {
            /** @enum {string} */
            status: "ready" | "not_ready";
            /** Format: date-time */
            checkedAt: string;
            checks: components["schemas"]["DependencyReadyStatus"][];
        };
        HealthLiveResponse: {
            data: components["schemas"]["LiveStatus"];
            /** @example prj_demo */
            requestId: string;
        };
        HealthReadyResponse: {
            data: components["schemas"]["ReadyStatus"];
            /** @example prj_demo */
            requestId: string;
        };
        /** @description Platform-only staged content upload. Font parser sandbox, malware checks and license evidence mandatory; kind/MIME adapter allowlist. User photo upload remains JPEG/PNG only. */
        AdminContentUpload: {
            /** @enum {string} */
            kind: "font" | "template_preview" | "preset_example";
            filename: string;
            /** @enum {string} */
            mime: "font/woff2" | "font/ttf" | "font/otf" | "image/png" | "image/jpeg";
            sizeBytes: number;
            /** @example 0000000000000000000000000000000000000000000000000000000000000000 */
            sha256: string;
            /** @example prj_demo */
            licenseRef: string;
            /** @constant */
            sourceRightsConfirmed: true;
        };
        AdminContentTicket: {
            /** @example prj_demo */
            stagedObjectId: string;
            /** @enum {string} */
            method: "PUT" | "POST";
            /** Format: uri */
            url: string;
            headers: components["schemas"]["UploadHeader"][];
            /** Format: date-time */
            expiresAt: string;
            maxBytes: number;
        };
        /** @description Immutable binding by spreadId/layerId, recursively resolving within the referenced spread. slotId and (spreadId,layerId) must each be unique. kind must equal actual image/text layer.type; groups/opaque/shape layers are not editable slots. image placeholders use actual registered platform asset bytes and bindingRequired=true; project creation replaces every required placeholder with an authorized workspace image or fails TEMPLATE_BINDING_REQUIRED. Text mini fields must be subset of document text.editableFields; no URL/seed-design/frame-only placeholder is publishable. */
        TemplateSlot: {
            /** @example prj_demo */
            slotId: string;
            /** @example prj_demo */
            spreadId: string;
            /** @example prj_demo */
            layerId: string;
            /** @enum {string} */
            kind: "image" | "text";
            miniEditableFields: ("text" | "crop" | "assetId")[];
            /** @description true for required image placeholders that must receive a workspace asset during project instantiation. Text slots use false. */
            bindingRequired: boolean;
            /** @description Registered immutable platform placeholder asset, never a synthetic client ID or arbitrary URL. Must equal assetId on the bound document image layer when bindingRequired=true. */
            placeholderAssetId?: components["schemas"]["Id"];
        } & (unknown & unknown & unknown);
        /** @description Create an immutable draft from a valid DocumentModel and exact typed slot bindings. Validate all slot/layer IDs, kind, placeholder asset IDs, font/resource licenses and mini-field whitelist against document. Only after review can publication activate it. content/template-seeds.json contains original draft slot designs and cannot be submitted directly: first instantiate full image/text layers, register placeholder/demo assets and licensed font files, then build this request. */
        TemplateVersionCreate: {
            /** @example prj_demo */
            templateId?: string;
            name: string;
            /** @enum {string} */
            scene: "wedding" | "travel" | "portrait" | "family" | "ink" | "other";
            document: components["schemas"]["root"];
            slots: components["schemas"]["TemplateSlot"][];
            /** @example prj_demo */
            licenseRef: string;
            /** @example prj_demo */
            previewStagedObjectId?: string;
            reason: string;
        };
        FontVersionCreate: {
            /** @example prj_demo */
            fontId?: string;
            /** @example prj_demo */
            stagedObjectId: string;
            family: string;
            style: string;
            /** @example prj_demo */
            licenseRef: string;
            embeddingAllowed: boolean;
            commercialAllowed: boolean;
            reason: string;
        };
        LicenseRecord: {
            /** @example prj_demo */
            id: string;
            name: string;
            source: string;
            termsVersion: string;
            commercialAllowed: boolean;
            embeddingAllowed: boolean;
            referenceImageAllowed: boolean;
            territories: string[];
            /** Format: date-time */
            expiresAt?: string;
            /** @example prj_demo */
            evidenceOutputId?: string;
            revision: number;
        };
        LicenseCreate: {
            name: string;
            source: string;
            termsVersion: string;
            commercialAllowed: boolean;
            embeddingAllowed: boolean;
            referenceImageAllowed: boolean;
            territories: string[];
            /** Format: date-time */
            expiresAt?: string;
            /** @example prj_demo */
            evidenceStagedObjectId?: string;
            reason: string;
        };
        CreateAdminContentUploadResponse: {
            data: components["schemas"]["AdminContentTicket"];
            /** @example prj_demo */
            requestId: string;
        };
        CreateTemplateVersionResponse: {
            data: components["schemas"]["ContentVersion"];
            /** @example prj_demo */
            requestId: string;
        };
        CreateFontVersionResponse: {
            data: components["schemas"]["ContentVersion"];
            /** @example prj_demo */
            requestId: string;
        };
        ListContentVersionsPage: {
            items: components["schemas"]["ContentVersion"][];
            nextCursor: string | null;
            hasMore: boolean;
        };
        ListContentVersionsResponse: {
            data: components["schemas"]["ListContentVersionsPage"];
            /** @example prj_demo */
            requestId: string;
        };
        CreateLicenseRecordResponse: {
            data: components["schemas"]["LicenseRecord"];
            /** @example prj_demo */
            requestId: string;
        };
        ListLicenseRecordsPage: {
            items: components["schemas"]["LicenseRecord"][];
            nextCursor: string | null;
            hasMore: boolean;
        };
        ListLicenseRecordsResponse: {
            data: components["schemas"]["ListLicenseRecordsPage"];
            /** @example prj_demo */
            requestId: string;
        };
        ProviderAdapterContract: components["schemas"]["provider.schema_$defs-root"];
        ProviderContractPage: {
            items: components["schemas"]["provider.schema_$defs-root"][];
            nextCursor: string | null;
            hasMore: boolean;
        };
        WechatEncryptedResource: {
            /** @enum {string} */
            algorithm: "AEAD_AES_256_GCM";
            ciphertext: string;
            nonce: string;
            associated_data?: string;
            original_type?: string;
        };
        WechatEncryptedCallback: {
            /** @example prj_demo */
            id: string;
            /** Format: date-time */
            create_time: string;
            event_type: string;
            /** @enum {string} */
            resource_type: "encrypt-resource";
            summary: string;
            resource: components["schemas"]["WechatEncryptedResource"];
        };
        PaymentCallbackData: {
            /** @example prj_demo */
            providerTransactionId: string;
            /** @example prj_demo */
            orderId: string;
            amountFen: number;
            /** @constant */
            currency: "CNY";
            /** @example prj_demo */
            appRef: string;
            /** @example prj_demo */
            merchantRef: string;
        };
        RefundCallbackData: {
            /** @example prj_demo */
            providerRefundId: string;
            /** @example prj_demo */
            refundId: string;
            /** @example prj_demo */
            orderId: string;
            amountFen: number;
            /** @constant */
            currency: "CNY";
        };
        ProviderResultPointer: {
            /** Format: uri */
            url: string;
            /** @enum {string} */
            mime: "image/jpeg" | "image/png";
            /** @example 0000000000000000000000000000000000000000000000000000000000000000 */
            sha256?: string;
        };
        GenerationCallbackData: {
            /** @example prj_demo */
            providerRequestId: string;
            /** @example prj_demo */
            providerJobId: string;
            /** @enum {string} */
            state: "succeeded" | "failed" | "cancelled";
            results: components["schemas"]["ProviderResultPointer"][];
            errorCode?: string;
        };
        NotificationCallbackData: {
            /** @example prj_demo */
            providerMessageId: string;
            /** @enum {string} */
            state: "delivered" | "failed";
            errorCode?: string;
        };
        /** @description Registered signed adapter envelope supported by platform-controlled webhook bridge. eventType/payload branch must correspond; adapter validates all IDs/account ownership. Direct vendors using another wire shape require a separately reviewed typed schema before enabling callback capability; use upstream query if absent. */
        RegisteredCallbackEnvelope: {
            /** @example prj_demo */
            eventId: string;
            /** @enum {string} */
            eventType: "payment.succeeded" | "payment.closed" | "refund.succeeded" | "refund.failed" | "generation.succeeded" | "generation.failed" | "generation.cancelled" | "notification.delivered" | "notification.failed";
            /** Format: date-time */
            occurredAt: string;
            /** @example prj_demo */
            accountRef: string;
            /** @example prj_demo */
            resourceId: string;
            payload: components["schemas"]["PaymentCallbackData"] | components["schemas"]["RefundCallbackData"] | components["schemas"]["GenerationCallbackData"] | components["schemas"]["NotificationCallbackData"];
        };
        /** @description Cryptographically random browser nonce generated locally before initial request, retained only for this login flow. Server separately issues/binds anonymous HttpOnly cookie; first request idempotency scope derives hash(browserNonce, Origin). Never use fingerprint/IP as sole browser binding. */
        QrSessionCreate: {
            browserNonce: string;
        };
        /** @description Bind a required template image slot to a ready immutable asset owned by the target workspace. Unique slotId; no external URL or platform placeholder may remain in instantiated required slot. */
        TemplateImageBinding: {
            slotId: components["schemas"]["Id"];
            assetId: components["schemas"]["Id"];
        };
        EditorResourceManifest: {
            assets: components["schemas"]["EditorAssetRecord"][];
            fonts: {
                id: string;
                version: number;
                sha256: string;
                family: string;
                source: {
                    /** @enum {unknown} */
                    kind: "import" | "bundled";
                    name: string;
                    url?: string;
                };
                license: {
                    id: string;
                    usable: boolean;
                    source?: string;
                    text?: string;
                };
                /** @enum {unknown} */
                status: "ready" | "missing" | "unlicensed";
                faces: {
                    id: string;
                    sha256: string;
                    byteLength: number;
                    file: string;
                    /** @enum {unknown} */
                    weight: 400 | 700;
                    /** @constant */
                    style: "normal";
                    codePoints: number[];
                }[];
            }[];
        };
        EditorAssetRecord: {
            id: string;
            version: number;
            sha256: string;
            width: number;
            height: number;
            /** @enum {unknown} */
            mimeType: "image/png" | "image/jpeg";
            source: {
                /** @enum {unknown} */
                kind: "import" | "bundled";
                name: string;
                url?: string;
            };
            license: {
                id: string;
                usable: boolean;
                source?: string;
                text?: string;
            };
            /** @enum {unknown} */
            status: "ready" | "missing" | "unlicensed";
            /** @enum {unknown} */
            usage?: "photo" | "decoration" | "mask" | "text-raster";
            variants: {
                original: {
                    sha256: string;
                    byteLength: number;
                    /** @enum {unknown} */
                    mimeType: "image/png" | "image/jpeg";
                    width: number;
                    height: number;
                };
                normalized: {
                    sha256: string;
                    byteLength: number;
                    /** @enum {unknown} */
                    mimeType: "image/png" | "image/jpeg";
                    width: number;
                    height: number;
                };
                preview: {
                    sha256: string;
                    byteLength: number;
                    /** @enum {unknown} */
                    mimeType: "image/png" | "image/jpeg";
                    width: number;
                    height: number;
                };
            };
        };
        FinancialAdjustmentCreate: {
            /** @enum {string} */
            kind: "credits" | "membership";
            sourceGrantId: string;
            creditDelta?: number;
            durationDays?: number;
            reason: string;
            ticketId: string;
        };
        FinancialAdjustment: {
            id: string;
            workspaceId: string;
            sourceGrantId: string;
            grantId?: string;
            /** @enum {string} */
            kind: "credits" | "membership";
            /** Format: date-time */
            createdAt: string;
        };
        FinancialAdjustmentResponse: {
            data: components["schemas"]["FinancialAdjustment"];
            requestId: components["schemas"]["Id"];
        };
        crop: {
            x: number;
            y: number;
            width: number;
            height: number;
        };
        filterRef: {
            presetId: string;
            recipeVersion: number;
            strength: number;
            seed: number;
        };
        image: {
            id: string;
            /** @constant */
            type: "image";
            x: number;
            y: number;
            width: number;
            height: number;
            rotation: number;
            opacity: number;
            visible: boolean;
            locked: boolean;
            assetId: string;
            /**
             * @default cover
             * @enum {unknown}
             */
            fitMode: "cover" | "contain";
            crop: components["schemas"]["crop"];
            filter?: components["schemas"]["filterRef"] | null;
            /**
             * @default photo
             * @enum {unknown}
             */
            role: "photo" | "decoration" | "generated";
            alphaMask?: {
                /** @constant */
                version: 1;
                assetId: string;
            };
            templateSlot?: {
                /** @constant */
                version: 1;
                slotId: string;
            };
        } & {
            [key: string]: unknown;
        };
        text: {
            id: string;
            /** @constant */
            type: "text";
            x: number;
            y: number;
            width: number;
            height: number;
            rotation: number;
            opacity: number;
            visible: boolean;
            locked: boolean;
            text: string;
            fontAssetId: string;
            fontSize: number;
            fontWeight: number;
            lineHeight: number;
            letterSpacing: number;
            /**
             * @default left
             * @enum {unknown}
             */
            textAlign: "left" | "center" | "right";
            fill: string;
            editableFields?: ("text" | "fontSize" | "fill" | "crop")[];
            /** @default true */
            critical: boolean;
        } & {
            [key: string]: unknown;
        };
        shape: {
            id: string;
            /** @constant */
            type: "shape";
            x: number;
            y: number;
            width: number;
            height: number;
            rotation: number;
            opacity: number;
            visible: boolean;
            locked: boolean;
            /** @enum {unknown} */
            shapeKind: "rectangle" | "ellipse" | "line";
            fill: string;
            stroke: string;
            strokeWidth: number;
            radius?: number;
        } & {
            [key: string]: unknown;
        };
        opaque: {
            id: string;
            type: string;
        } & {
            [key: string]: unknown;
        };
        leaf: components["schemas"]["image"] | components["schemas"]["text"] | components["schemas"]["shape"] | components["schemas"]["opaque"];
        group5: {
            id: string;
            /** @constant */
            type: "group";
            x: number;
            y: number;
            width: number;
            height: number;
            rotation: number;
            opacity: number;
            visible: boolean;
            locked: boolean;
            /** @default 1 */
            scale: number;
            children: components["schemas"]["leaf"][];
        } & {
            [key: string]: unknown;
        };
        group4: {
            id: string;
            /** @constant */
            type: "group";
            x: number;
            y: number;
            width: number;
            height: number;
            rotation: number;
            opacity: number;
            visible: boolean;
            locked: boolean;
            /** @default 1 */
            scale: number;
            children: (components["schemas"]["leaf"] | components["schemas"]["group5"])[];
        } & {
            [key: string]: unknown;
        };
        group3: {
            id: string;
            /** @constant */
            type: "group";
            x: number;
            y: number;
            width: number;
            height: number;
            rotation: number;
            opacity: number;
            visible: boolean;
            locked: boolean;
            /** @default 1 */
            scale: number;
            children: (components["schemas"]["leaf"] | components["schemas"]["group4"])[];
        } & {
            [key: string]: unknown;
        };
        group2: {
            id: string;
            /** @constant */
            type: "group";
            x: number;
            y: number;
            width: number;
            height: number;
            rotation: number;
            opacity: number;
            visible: boolean;
            locked: boolean;
            /** @default 1 */
            scale: number;
            children: (components["schemas"]["leaf"] | components["schemas"]["group3"])[];
        } & {
            [key: string]: unknown;
        };
        group1: {
            id: string;
            /** @constant */
            type: "group";
            x: number;
            y: number;
            width: number;
            height: number;
            rotation: number;
            opacity: number;
            visible: boolean;
            locked: boolean;
            /** @default 1 */
            scale: number;
            children: (components["schemas"]["leaf"] | components["schemas"]["group2"])[];
        } & {
            [key: string]: unknown;
        };
        layer: components["schemas"]["leaf"] | components["schemas"]["group1"];
        templateRef: {
            id: string;
            version: number;
            sha256: string;
        };
        spread: {
            id: string;
            background: string;
            layers: components["schemas"]["layer"][];
            templateRef?: components["schemas"]["templateRef"];
        } & {
            [key: string]: unknown;
        };
        assignmentManifest: {
            version?: number;
            /** @enum {unknown} */
            selectionPolicy: "all" | "allowSelection";
            /** @enum {unknown} */
            duplicatePolicy: "forbid" | "allowExplicit";
            inputAssetIds: string[];
            placements: {
                assetId: string;
                spreadId: string;
                layerId: string;
            }[];
            unusedAssetIds: string[];
            repeatedAssetIds: string[];
            violations: {
                code: string;
                message: string;
                assetIds?: string[];
                layerIds?: string[];
            }[];
        };
        root: {
            /** @constant */
            schemaVersion: 1;
            projectId: string;
            revision: number;
            /** @constant */
            unit: "px96";
            /** @constant */
            colorSpace: "srgb";
            pageSize: {
                width: number;
                height: number;
            };
            printProfile: {
                bleedMm: number;
                safeMm: number;
            };
            cover: {
                front: components["schemas"]["layer"][];
                back: components["schemas"]["layer"][];
            };
            spreads: components["schemas"]["spread"][];
            assignmentManifest?: components["schemas"]["assignmentManifest"];
        } & {
            [key: string]: unknown;
        };
        "$defs-root": {
            projectId: string;
            baseRevision: number;
            photos: {
                assetId: string;
                width: number;
                height: number;
                captureTime?: string | null;
                groupId?: string;
                weight?: number;
            }[];
            constraints: {
                spreadCount: number;
                minPhotosPerSpread: number;
                maxPhotosPerSpread: number;
                /**
                 * @default all
                 * @enum {unknown}
                 */
                selectionPolicy: "all" | "allowSelection";
                /**
                 * @default forbid
                 * @enum {unknown}
                 */
                duplicatePolicy: "forbid" | "allowExplicit";
                explicitRepeatAssetIds?: string[];
                requiredAssetIds?: string[];
                excludedAssetIds?: string[];
                /** @enum {unknown} */
                orderPolicy: "user" | "captureTime";
                lockedSpreadIds?: string[];
                lockedLayerIds?: string[];
                targetSpreadIds?: string[];
            };
            templateRef: components["schemas"]["templateRef"];
            algorithmVersion: string;
            seed: number;
            templatePageIds?: string[];
        };
        "export.schema_$defs-root": {
            /** @enum {unknown} */
            format: "png" | "jpeg" | "pdf";
            /** @enum {unknown} */
            dpi: 72 | 150 | 300;
            /** @enum {unknown} */
            view: "singlePage" | "spread";
            pageIds: string[];
            includeCover: boolean;
            bleedMm: number;
            jpegMatte: string;
        };
        storage: {
            /** @constant */
            kind: "storage";
            /** @enum {unknown} */
            provider: "oss" | "cos" | "s3";
            adapterVersion: string;
            region: string;
            /** Format: uri */
            endpoint: string;
            bucket: string;
            credential: {
                secretRef: string;
                secretVersion: string;
            };
            basePrefix: string;
            /** @constant */
            keyPatternVersion: "v1";
            /** @constant */
            publicAccess: false;
            allowedOrigins: string[];
            downloadTtlSeconds: number;
            uploadTtlSeconds: number;
            /** @enum {unknown} */
            encryptionMode: "providerManaged" | "kms";
            kmsKeyRef?: string;
            /** @enum {unknown} */
            cdnMode: "disabled" | "signed";
            downloadDomain?: string;
            retentionPolicyRef: {
                id: string;
                version: number;
            };
            quotaPolicyRef: {
                id: string;
                version: number;
            };
        };
        aiConnection: {
            /** @constant */
            kind: "aiConnection";
            adapterId: string;
            adapterVersion: string;
            name: string;
            /** Format: uri */
            baseUrl: string;
            credential: {
                secretRef: string;
                secretVersion: string;
            };
            accountBillingId: string;
            region?: string;
            connectTimeoutMs: number;
            requestTimeoutMs: number;
            maxConcurrent: number;
            requestsPerMinute: number;
            dailyBudgetFen: number;
            /** @constant */
            budgetTimezone: "Asia/Shanghai";
            dataUsePolicyRef: {
                id: string;
                version: number;
            };
            enabled: boolean;
        };
        auth: {
            /** @constant */
            kind: "auth";
            webAppId: string;
            miniAppId: string;
            webCredential: {
                secretRef: string;
                secretVersion: string;
            };
            miniCredential: {
                secretRef: string;
                secretVersion: string;
            };
            callbackOrigins: string[];
            accessTtlSeconds: number;
            refreshTtlSeconds: number;
            smsEnabled: boolean;
            smsConnectionRef?: {
                id: string;
                version: number;
            };
            registrationEnabled: boolean;
        };
        payment: {
            /** @constant */
            kind: "payment";
            /** @enum {unknown} */
            channel: "wechat_pay" | "wechat_virtual";
            appId: string;
            merchantId: string;
            credential: {
                secretRef: string;
                secretVersion: string;
            };
            verificationKeyRef: string;
            callbackUrl: string;
            refundEnabled: boolean;
            platformCapabilityRef: {
                id: string;
                version: number;
            };
            enabled: boolean;
        };
        sku: {
            /** @constant */
            kind: "sku";
            skuId: string;
            /** @enum {unknown} */
            skuKind: "membership" | "credits";
            name: string;
            priceFen: number;
            /** @constant */
            currency: "CNY";
            durationDays: number;
            credits: number;
            creditValidityDays: number;
            features: {
                storageBytes: number;
                maxProjectPhotos: number;
                maxSpreads: number;
                exportDpis: (72 | 150 | 300)[];
                exportConcurrency: number;
                aiConcurrency: number;
                seatLimit: number;
                commercialTemplateSetIds: string[];
            };
            refundPolicyRef: {
                id: string;
                version: number;
            };
            enabled: boolean;
        };
        editor: {
            /** @constant */
            kind: "editor";
            filterManifestVersion: {
                id: string;
                version: number;
            };
            fontCatalogVersion: {
                id: string;
                version: number;
            };
            templateCatalogVersion: {
                id: string;
                version: number;
            };
            undoLimit: number;
            autosaveIdleMs: number;
            autosaveMaxMs: number;
            maxLayersPerSpread: number;
            maxGroupDepth: number;
            snapScreenPixels: number;
        };
        layout: {
            /** @constant */
            kind: "layout";
            algorithmVersion: string;
            candidateCount: number;
            minPhotosPerSpread: number;
            maxPhotosPerSpread: number;
            /** @enum {unknown} */
            selectionPolicy: "all" | "allowSelection";
            /** @enum {unknown} */
            duplicatePolicy: "forbid" | "allowExplicit";
            weights: {
                subject: number;
                timeline: number;
                whitespace: number;
                variety: number;
                color: number;
            };
        };
        export: {
            /** @constant */
            kind: "export";
            allowedFormats: ("png" | "jpeg" | "pdf")[];
            allowedDpis: (72 | 150 | 300)[];
            maxSurfacePixels: number;
            browserBudgetMiB: number;
            workerBudgetMiB: number;
            /** @constant */
            ppiWarning: 200;
            /** @constant */
            ppiStrongWarning: 100;
            outputRetentionDays: number;
            jpegQuality: number;
            jpegMatte: string;
        };
        queue: {
            /** @constant */
            kind: "queue";
            /** @enum {unknown} */
            workerKind: "export" | "generation" | "layout" | "storageMigration";
            maxGlobalConcurrency: number;
            maxWorkspaceConcurrency: number;
            leaseSeconds: number;
            heartbeatSeconds: number;
            retryLimit: number;
            retryBackoffSeconds: number[];
            maxWaitingSeconds: number;
            maxAttemptsPerTask: number;
        };
        content: {
            /** @constant */
            kind: "content";
            moderationRouteRef: {
                id: string;
                version: number;
            };
            labelPolicyRef: {
                id: string;
                version: number;
            };
            licensePolicyVersion: {
                id: string;
                version: number;
            };
            allowedOrigins: ("uploaded" | "generated" | "platform")[];
            /** @constant */
            referenceConsentRequired: true;
            /** @constant */
            quarantineOnUnverified: true;
        };
        share: {
            /** @constant */
            kind: "share";
            /** @constant */
            defaultPrivate: true;
            sharingEnabled: boolean;
            maxShareTtlSeconds: number;
            downloadTtlSeconds: number;
            /** @enum {unknown} */
            revokeMode: "shortLivedUrl" | "gateway";
            allowOriginalDownload: boolean;
        };
        notification: {
            /** @constant */
            kind: "notification";
            channels: ("inApp" | "wechatSubscription" | "sms")[];
            credential?: {
                secretRef: string;
                secretVersion: string;
            };
            templateRefs: {
                id: string;
                version: number;
            }[];
            /** @constant */
            userConsentRequired: true;
            enabledEvents: ("exportSucceeded" | "exportFailed" | "generationSucceeded" | "generationFailed" | "paymentFulfilled" | "refundCompleted" | "storageWarning" | "membershipExpiring")[];
        };
        retention: {
            /** @constant */
            kind: "retention";
            trashDays: number;
            outputDays: number;
            temporaryHours: number;
            revisionKeepCount: number;
            backupRetentionDays: number;
            auditRetentionDays: number;
            /** @constant */
            honorPins: true;
            /** @constant */
            replayDeletionTombstones: true;
        };
        monitor: {
            /** @constant */
            kind: "monitor";
            dailyBudgetWarnRatio: number;
            /** @constant */
            dailyBudgetStopRatio: 1;
            storageWarnRatio: number;
            apiErrorRatio: number;
            queueOldestSeconds: number;
            alertSinkRefs: string[];
            /** @constant */
            redactPersonalData: true;
        };
        workspace: {
            /** @constant */
            kind: "workspace";
            defaultFeatures: {
                storageBytes: number;
                maxProjectPhotos: number;
                maxSpreads: number;
                exportDpis: (72 | 150 | 300)[];
                exportConcurrency: number;
                aiConcurrency: number;
                seatLimit: number;
                commercialTemplateSetIds: string[];
            };
            roles: ("owner" | "admin" | "designer" | "viewer")[];
            designerCanDeleteUnusedAssets: boolean;
            /** @constant */
            seatInvitationEnabled: false;
            /** @constant */
            byosEnabled: false;
            /** @constant */
            byokEnabled: false;
        };
        account: {
            /** @constant */
            kind: "account";
            deletionGraceDays: number;
            /** @constant */
            requireReauthentication: true;
            /** @constant */
            sessionRevokeOnDeletion: true;
            /** @constant */
            defaultDisplayTimezone: "Asia/Shanghai";
            privacyPolicyVersion: {
                id: string;
                version: number;
            };
            termsVersion: {
                id: string;
                version: number;
            };
        };
        site: {
            /** @constant */
            kind: "site";
            productName: string;
            publicOrigin: string;
            miniAppId: string;
            supportContact: string;
            maintenanceMode: boolean;
            webEnabled: boolean;
            miniEnabled: boolean;
            privacyPolicyVersion: {
                id: string;
                version: number;
            };
            termsVersion: {
                id: string;
                version: number;
            };
        };
        upload: {
            /** @constant */
            kind: "upload";
            allowedMimeTypes: ("image/jpeg" | "image/png")[];
            maxFileBytes: number;
            maxSourcePixels: number;
            maxProjectPhotos: number;
            previewLongEdge: number;
            maxFolderDepth: number;
            maxFolderNameChars: number;
            multipartEnabled: boolean;
            multipartThresholdBytes?: number;
            multipartPartBytes?: number;
            activeStorageProfileRef: {
                id: string;
                version: number;
            };
        };
        aiRoute: {
            /** @constant */
            kind: "aiRoute";
            /** @enum {unknown} */
            capability: "textToImage" | "imageToImage" | "textSuggestion" | "moderation";
            primaryModelRef: {
                id: string;
                version: number;
            };
            fallbackModelRefs: {
                id: string;
                version: number;
            }[];
            /** @constant */
            fallbackPolicy: "beforeAcceptanceOnly";
            enabled: boolean;
        };
        aiPricing: {
            /** @constant */
            kind: "aiPricing";
            costRuleId: string;
            modelRef: {
                id: string;
                version: number;
            };
            presetRef: {
                id: string;
                version: number;
            };
            creditsPerImage: number;
            estimatedProviderCostFen: number;
            quoteTtlSeconds: number;
            unknownFinalTimeoutSeconds: number;
            /** @constant */
            countPerChildTask: 1;
            enabled: boolean;
        };
        albumDefaults: {
            /** @constant */
            kind: "albumDefaults";
            pageWidthMm: number;
            pageHeightMm: number;
            interiorSpreadCount: number;
            bleedMm: number;
            safeMm: number;
            templateRef: {
                id: string;
                version: number;
            };
        };
        "config.schema_$defs-root": components["schemas"]["storage"] | components["schemas"]["aiConnection"] | components["schemas"]["auth"] | components["schemas"]["payment"] | components["schemas"]["sku"] | components["schemas"]["editor"] | components["schemas"]["layout"] | components["schemas"]["export"] | components["schemas"]["queue"] | components["schemas"]["content"] | components["schemas"]["share"] | components["schemas"]["notification"] | components["schemas"]["retention"] | components["schemas"]["monitor"] | components["schemas"]["workspace"] | components["schemas"]["account"] | components["schemas"]["site"] | components["schemas"]["upload"] | components["schemas"]["aiRoute"] | components["schemas"]["aiPricing"] | components["schemas"]["albumDefaults"];
        "provider.schema_$defs-root": {
            adapterId: string;
            adapterVersion: string;
            providerName: string;
            capabilities: ("textToImage" | "imageToImage" | "textSuggestion" | "asyncQuery" | "cancel" | "idempotentSubmit")[];
            allowedEndpointHosts: string[];
            allowedResultHosts: string[];
            supportsModelDiscovery: boolean;
            modelLimits: {
                maxInputBytes: number;
                maxReferenceImages: number;
                maxOutputPixels: number;
                maxPromptChars: number;
                acceptedMimeTypes: ("image/jpeg" | "image/png")[];
            };
            contractTestRef: string;
        };
    };
    responses: {
        /** @description 400 INVALID_REQUEST. See error code registry and retry rules in API-GUIDE.md. */
        BadRequest: {
            headers: {
                "X-Request-Id"?: string;
                [name: string]: unknown;
            };
            content: {
                /**
                 * @example {
                 *       "error": {
                 *         "code": "INVALID_REQUEST",
                 *         "message": "示例错误，请按 code 处理",
                 *         "retryable": false,
                 *         "details": []
                 *       },
                 *       "requestId": "req_demo"
                 *     }
                 */
                "application/json": components["schemas"]["Error"];
            };
        };
        /** @description 401 AUTH_EXPIRED. See error code registry and retry rules in API-GUIDE.md. */
        Unauthorized: {
            headers: {
                "X-Request-Id"?: string;
                [name: string]: unknown;
            };
            content: {
                /**
                 * @example {
                 *       "error": {
                 *         "code": "AUTH_EXPIRED",
                 *         "message": "示例错误，请按 code 处理",
                 *         "retryable": false,
                 *         "details": []
                 *       },
                 *       "requestId": "req_demo"
                 *     }
                 */
                "application/json": components["schemas"]["Error"];
            };
        };
        /** @description 402 CREDIT_INSUFFICIENT. See error code registry and retry rules in API-GUIDE.md. */
        PaymentRequired: {
            headers: {
                "X-Request-Id"?: string;
                [name: string]: unknown;
            };
            content: {
                /**
                 * @example {
                 *       "error": {
                 *         "code": "CREDIT_INSUFFICIENT",
                 *         "message": "示例错误，请按 code 处理",
                 *         "retryable": false,
                 *         "details": []
                 *       },
                 *       "requestId": "req_demo"
                 *     }
                 */
                "application/json": components["schemas"]["Error"];
            };
        };
        /** @description 403 FORBIDDEN. See error code registry and retry rules in API-GUIDE.md. */
        Forbidden: {
            headers: {
                "X-Request-Id"?: string;
                [name: string]: unknown;
            };
            content: {
                /**
                 * @example {
                 *       "error": {
                 *         "code": "FORBIDDEN",
                 *         "message": "示例错误，请按 code 处理",
                 *         "retryable": false,
                 *         "details": []
                 *       },
                 *       "requestId": "req_demo"
                 *     }
                 */
                "application/json": components["schemas"]["Error"];
            };
        };
        /** @description 404 NOT_FOUND. See error code registry and retry rules in API-GUIDE.md. */
        NotFound: {
            headers: {
                "X-Request-Id"?: string;
                [name: string]: unknown;
            };
            content: {
                /**
                 * @example {
                 *       "error": {
                 *         "code": "NOT_FOUND",
                 *         "message": "示例错误，请按 code 处理",
                 *         "retryable": false,
                 *         "details": []
                 *       },
                 *       "requestId": "req_demo"
                 *     }
                 */
                "application/json": components["schemas"]["Error"];
            };
        };
        /** @description 409 REVISION_CONFLICT. See error code registry and retry rules in API-GUIDE.md. */
        Conflict: {
            headers: {
                "X-Request-Id"?: string;
                [name: string]: unknown;
            };
            content: {
                /**
                 * @example {
                 *       "error": {
                 *         "code": "REVISION_CONFLICT",
                 *         "message": "示例错误，请按 code 处理",
                 *         "retryable": false,
                 *         "details": []
                 *       },
                 *       "requestId": "req_demo"
                 *     }
                 */
                "application/json": components["schemas"]["Error"];
            };
        };
        /** @description 410 RESOURCE_EXPIRED. See error code registry and retry rules in API-GUIDE.md. */
        Gone: {
            headers: {
                "X-Request-Id"?: string;
                [name: string]: unknown;
            };
            content: {
                /**
                 * @example {
                 *       "error": {
                 *         "code": "RESOURCE_EXPIRED",
                 *         "message": "示例错误，请按 code 处理",
                 *         "retryable": false,
                 *         "details": []
                 *       },
                 *       "requestId": "req_demo"
                 *     }
                 */
                "application/json": components["schemas"]["Error"];
            };
        };
        /** @description 413 PAYLOAD_TOO_LARGE. See error code registry and retry rules in API-GUIDE.md. */
        PayloadTooLarge: {
            headers: {
                "X-Request-Id"?: string;
                [name: string]: unknown;
            };
            content: {
                /**
                 * @example {
                 *       "error": {
                 *         "code": "PAYLOAD_TOO_LARGE",
                 *         "message": "示例错误，请按 code 处理",
                 *         "retryable": false,
                 *         "details": []
                 *       },
                 *       "requestId": "req_demo"
                 *     }
                 */
                "application/json": components["schemas"]["Error"];
            };
        };
        /** @description 422 VALIDATION_FAILED. See error code registry and retry rules in API-GUIDE.md. */
        Unprocessable: {
            headers: {
                "X-Request-Id"?: string;
                [name: string]: unknown;
            };
            content: {
                /**
                 * @example {
                 *       "error": {
                 *         "code": "VALIDATION_FAILED",
                 *         "message": "示例错误，请按 code 处理",
                 *         "retryable": false,
                 *         "details": []
                 *       },
                 *       "requestId": "req_demo"
                 *     }
                 */
                "application/json": components["schemas"]["Error"];
            };
        };
        /** @description 428 CAS_REQUIRED. See error code registry and retry rules in API-GUIDE.md. */
        PreconditionRequired: {
            headers: {
                "X-Request-Id"?: string;
                [name: string]: unknown;
            };
            content: {
                /**
                 * @example {
                 *       "error": {
                 *         "code": "CAS_REQUIRED",
                 *         "message": "示例错误，请按 code 处理",
                 *         "retryable": false,
                 *         "details": []
                 *       },
                 *       "requestId": "req_demo"
                 *     }
                 */
                "application/json": components["schemas"]["Error"];
            };
        };
        /** @description 429 RATE_LIMITED. See error code registry and retry rules in API-GUIDE.md. */
        RateLimited: {
            headers: {
                "X-Request-Id"?: string;
                "Retry-After"?: number;
                [name: string]: unknown;
            };
            content: {
                /**
                 * @example {
                 *       "error": {
                 *         "code": "RATE_LIMITED",
                 *         "message": "示例错误，请按 code 处理",
                 *         "retryable": true,
                 *         "details": []
                 *       },
                 *       "requestId": "req_demo"
                 *     }
                 */
                "application/json": components["schemas"]["Error"];
            };
        };
        /** @description 503 CAPABILITY_UNAVAILABLE. See error code registry and retry rules in API-GUIDE.md. */
        Unavailable: {
            headers: {
                "X-Request-Id"?: string;
                "Retry-After"?: number;
                [name: string]: unknown;
            };
            content: {
                /**
                 * @example {
                 *       "error": {
                 *         "code": "CAPABILITY_UNAVAILABLE",
                 *         "message": "示例错误，请按 code 处理",
                 *         "retryable": true,
                 *         "details": []
                 *       },
                 *       "requestId": "req_demo"
                 *     }
                 */
                "application/json": components["schemas"]["Error"];
            };
        };
        /** @description Unexpected internal fault; opaque message, correlation requestId, no automatic replay of financial/upstream submit unless idempotency state reconciled. */
        InternalError: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["Error"];
            };
        };
    };
    parameters: {
        /**
         * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
         * @example demo_key_0000000000000001
         */
        IdempotencyKey: string;
        /**
         * @description Required CAS header: exactly quoted decimal resource revision, e.g. "12". Missing 428; stale 409 REVISION_CONFLICT. Must not use wildcard or timestamps.
         * @example "12"
         */
        IfMatch: string;
        /**
         * @description Fresh purpose-bound server-issued proof; required for privileged secret/financial/ownership/deletion actions; never logged.
         * @example demo_key_0000000000000001
         */
        ReauthenticationProof: string;
        /** @description Opaque signed cursor binding tenant, sort and filters; invalid/expired cursor returns 400. Never accepts SQL offsets or resource ownership through cursor. */
        Cursor: string;
        Limit: number;
    };
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    getCapabilities: {
        parameters: {
            query: {
                platform: "web" | "mini" | "app_reserved";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 读取当前客户端能力 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GetCapabilitiesResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    loginWechatMini: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MiniLogin"];
            };
        };
        responses: {
            /** @description 微信小程序登录 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LoginWechatMiniResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    createSmsChallenge: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SmsChallengeRequest"];
            };
        };
        responses: {
            /** @description 发起短信验证 */
            201: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreateSmsChallengeResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    loginSmsWeb: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SmsLogin"];
            };
        };
        responses: {
            /** @description 短信网页登录 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LoginSmsWebResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    createQrSession: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "browserNonce": "DEMO_BROWSER_NONCE_0000000000000000"
                 *     }
                 */
                "application/json": components["schemas"]["QrSessionCreate"];
            };
        };
        responses: {
            /** @description 创建网页扫码会话 */
            201: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreateQrSessionResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    pollQrSession: {
        parameters: {
            query?: never;
            header: {
                "X-Browser-Nonce": string;
            };
            path: {
                qrSessionId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 公开扫码流程状态轮询 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PollQrSessionResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    confirmQrSession: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                qrSessionId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["QrConfirm"];
            };
        };
        responses: {
            /** @description 已登录小程序确认扫码 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConfirmQrSessionResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    consumeQrSession: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                qrSessionId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["QrConsume"];
            };
        };
        responses: {
            /** @description 网页单次消费登录确认 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConsumeQrSessionResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    refreshMiniSession: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RefreshSession"];
            };
        };
        responses: {
            /** @description 轮换小程序刷新凭据 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RefreshMiniSessionResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    getWebSession: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 读取网页会话与CSRF */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GetWebSessionResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    logoutSession: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 撤销当前会话 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LogoutSessionResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    listSessions: {
        parameters: {
            query?: {
                /** @description Opaque signed cursor binding tenant, sort and filters; invalid/expired cursor returns 400. Never accepts SQL offsets or resource ownership through cursor. */
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 列出本人会话 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ListSessionsResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    revokeSession: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                sessionId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 撤销本人指定会话 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RevokeSessionResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    getMe: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 读取本人账户 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GetMeResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    listBindings: {
        parameters: {
            query?: {
                /** @description Opaque signed cursor binding tenant, sort and filters; invalid/expired cursor returns 400. Never accepts SQL offsets or resource ownership through cursor. */
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 列出本人绑定身份 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ListBindingsResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    createBinding: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BindingCreate"];
            };
        };
        responses: {
            /** @description 绑定重新验证的身份 */
            201: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreateBindingResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    deleteBinding: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                bindingId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BindingDelete"];
            };
        };
        responses: {
            /** @description 解绑身份并保留有效登录方式 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DeleteBindingResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    requestAccountDeletion: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "reauthProof": "DEMO_PROOF_NOT_A_CREDENTIAL",
                 *       "confirm": "DELETE_ACCOUNT"
                 *     }
                 */
                "application/json": components["schemas"]["DeletionRequest"];
            };
        };
        responses: {
            /** @description 申请账户删除 */
            202: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RequestAccountDeletionResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    getAccountDeletion: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 查询账户删除状态 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GetAccountDeletionResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    cancelAccountDeletion: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 在截止时间前取消删除 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CancelAccountDeletionResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    createPrivacyExport: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PrivacyExportCreate"];
            };
        };
        responses: {
            /** @description 申请个人数据导出 */
            202: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreatePrivacyExportResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    getPreferences: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 读取个人偏好 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    /** @description Quoted current revision for subsequent CAS. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GetPreferencesResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    updatePreferences: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /**
                 * @description Required CAS header: exactly quoted decimal resource revision, e.g. "12". Missing 428; stale 409 REVISION_CONFLICT. Must not use wildcard or timestamps.
                 * @example "12"
                 */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PreferencesUpdate"];
            };
        };
        responses: {
            /** @description 更新个人偏好 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    /** @description Quoted current revision for subsequent CAS. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UpdatePreferencesResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    listWorkspaces: {
        parameters: {
            query?: {
                /** @description Opaque signed cursor binding tenant, sort and filters; invalid/expired cursor returns 400. Never accepts SQL offsets or resource ownership through cursor. */
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 列出所属工作区 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ListWorkspacesResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    createWorkspace: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "name": "演示影楼",
                 *       "kind": "studio"
                 *     }
                 */
                "application/json": components["schemas"]["WorkspaceCreate"];
            };
        };
        responses: {
            /** @description 创建个人或影楼工作区 */
            201: {
                headers: {
                    "X-Request-Id"?: string;
                    /** @description Quoted current revision for subsequent CAS. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreateWorkspaceResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    getWorkspace: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 读取工作区 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    /** @description Quoted current revision for subsequent CAS. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GetWorkspaceResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    updateWorkspace: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /**
                 * @description Required CAS header: exactly quoted decimal resource revision, e.g. "12". Missing 428; stale 409 REVISION_CONFLICT. Must not use wildcard or timestamps.
                 * @example "12"
                 */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["WorkspaceUpdate"];
            };
        };
        responses: {
            /** @description 更新工作区偏好 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    /** @description Quoted current revision for subsequent CAS. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UpdateWorkspaceResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    listMembers: {
        parameters: {
            query?: {
                /** @description Opaque signed cursor binding tenant, sort and filters; invalid/expired cursor returns 400. Never accepts SQL offsets or resource ownership through cursor. */
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
            };
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 列出工作区成员 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ListMembersResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    removeMember: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /**
                 * @description Required CAS header: exactly quoted decimal resource revision, e.g. "12". Missing 428; stale 409 REVISION_CONFLICT. Must not use wildcard or timestamps.
                 * @example "12"
                 */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                workspaceId: string;
                memberId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 移除成员 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RemoveMemberResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    updateMember: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /**
                 * @description Required CAS header: exactly quoted decimal resource revision, e.g. "12". Missing 428; stale 409 REVISION_CONFLICT. Must not use wildcard or timestamps.
                 * @example "12"
                 */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                workspaceId: string;
                memberId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MemberUpdate"];
            };
        };
        responses: {
            /** @description 修改成员角色 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    /** @description Quoted current revision for subsequent CAS. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UpdateMemberResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    createInvitation: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["InvitationCreate"];
            };
        };
        responses: {
            /** @description 创建限期成员邀请 */
            201: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreateInvitationResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    acceptInvitation: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["InvitationAccept"];
            };
        };
        responses: {
            /** @description 接受邀请并检查席位 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    /** @description Quoted current revision for subsequent CAS. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AcceptInvitationResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    revokeInvitation: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                workspaceId: string;
                invitationId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 撤销工作区邀请 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RevokeInvitationResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    transferOwnership: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /**
                 * @description Required CAS header: exactly quoted decimal resource revision, e.g. "12". Missing 428; stale 409 REVISION_CONFLICT. Must not use wildcard or timestamps.
                 * @example "12"
                 */
                "If-Match": components["parameters"]["IfMatch"];
                /**
                 * @description Fresh purpose-bound server-issued proof; required for privileged secret/financial/ownership/deletion actions; never logged.
                 * @example demo_key_0000000000000001
                 */
                "X-Reauthentication-Proof": components["parameters"]["ReauthenticationProof"];
            };
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["OwnershipTransfer"];
            };
        };
        responses: {
            /** @description 将所有权转交现有成员 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    /** @description Quoted current revision for subsequent CAS. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TransferOwnershipResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    getWorkspaceUsage: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 读取物理用量与预占 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GetWorkspaceUsageResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    createUpload: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "filename": "demo.jpg",
                 *       "sizeBytes": 1024,
                 *       "declaredMime": "image/jpeg",
                 *       "sha256": "0000000000000000000000000000000000000000000000000000000000000000",
                 *       "folderId": null
                 *     }
                 */
                "application/json": components["schemas"]["UploadCreate"];
            };
        };
        responses: {
            /** @description 预占配额并签发受限上传 */
            201: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreateUploadResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    completeUpload: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                assetId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UploadComplete"];
            };
        };
        responses: {
            /** @description 完成上传进入验证 */
            202: {
                headers: {
                    "X-Request-Id"?: string;
                    /** @description Quoted current revision for subsequent CAS. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CompleteUploadResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    listAssets: {
        parameters: {
            query?: {
                /** @description Opaque signed cursor binding tenant, sort and filters; invalid/expired cursor returns 400. Never accepts SQL offsets or resource ownership through cursor. */
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
                folderId?: string;
                q?: string;
                state?: "ready" | "pending_scan" | "rejected" | "trashed";
                sort?: "name_asc" | "created_desc";
            };
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 分页检索工作区素材 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ListAssetsResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    getAsset: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                assetId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 读取素材元数据 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    /** @description Quoted current revision for subsequent CAS. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GetAssetResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    trashAsset: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /**
                 * @description Required CAS header: exactly quoted decimal resource revision, e.g. "12". Missing 428; stale 409 REVISION_CONFLICT. Must not use wildcard or timestamps.
                 * @example "12"
                 */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                assetId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 无破坏引用地回收素材 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TrashAssetResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    moveAsset: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /**
                 * @description Required CAS header: exactly quoted decimal resource revision, e.g. "12". Missing 428; stale 409 REVISION_CONFLICT. Must not use wildcard or timestamps.
                 * @example "12"
                 */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                assetId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AssetUpdate"];
            };
        };
        responses: {
            /** @description 移动素材逻辑文件夹 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    /** @description Quoted current revision for subsequent CAS. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MoveAssetResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    getAssetReferences: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                assetId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 查询素材项目与任务引用 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GetAssetReferencesResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    restoreAsset: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /**
                 * @description Required CAS header: exactly quoted decimal resource revision, e.g. "12". Missing 428; stale 409 REVISION_CONFLICT. Must not use wildcard or timestamps.
                 * @example "12"
                 */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                assetId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AssetRestore"];
            };
        };
        responses: {
            /** @description 恢复回收站素材 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    /** @description Quoted current revision for subsequent CAS. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RestoreAssetResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    createAssetDownloadToken: {
        parameters: {
            query: {
                variant: "original" | "normalized" | "preview";
            };
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                assetId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 签发素材私有下载令牌 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreateAssetDownloadTokenResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    listFolders: {
        parameters: {
            query?: {
                /** @description Opaque signed cursor binding tenant, sort and filters; invalid/expired cursor returns 400. Never accepts SQL offsets or resource ownership through cursor. */
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
                parentId?: string;
                state?: "active" | "trashed";
                q?: string;
            };
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 列出逻辑目录及回收站 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ListFoldersResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    createFolder: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "name": "旅行原片",
                 *       "parentId": null
                 *     }
                 */
                "application/json": components["schemas"]["FolderCreate"];
            };
        };
        responses: {
            /** @description 创建工作区逻辑目录 */
            201: {
                headers: {
                    "X-Request-Id"?: string;
                    /** @description Quoted current revision for subsequent CAS. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreateFolderResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    getFolder: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                folderId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 读取逻辑目录 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    /** @description Quoted current revision for subsequent CAS. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GetFolderResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    trashFolder: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /**
                 * @description Required CAS header: exactly quoted decimal resource revision, e.g. "12". Missing 428; stale 409 REVISION_CONFLICT. Must not use wildcard or timestamps.
                 * @example "12"
                 */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                folderId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 原子回收目录树 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TrashFolderResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    updateFolder: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /**
                 * @description Required CAS header: exactly quoted decimal resource revision, e.g. "12". Missing 428; stale 409 REVISION_CONFLICT. Must not use wildcard or timestamps.
                 * @example "12"
                 */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                folderId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["FolderUpdate"];
            };
        };
        responses: {
            /** @description 重命名或移动目录 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    /** @description Quoted current revision for subsequent CAS. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UpdateFolderResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    previewFolderDelete: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                folderId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 查询整树删除影响 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PreviewFolderDeleteResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    restoreFolder: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /**
                 * @description Required CAS header: exactly quoted decimal resource revision, e.g. "12". Missing 428; stale 409 REVISION_CONFLICT. Must not use wildcard or timestamps.
                 * @example "12"
                 */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                folderId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["FolderRestore"];
            };
        };
        responses: {
            /** @description 原子恢复目录树 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    /** @description Quoted current revision for subsequent CAS. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RestoreFolderResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    batchMoveAssets: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["FolderBatchMove"];
            };
        };
        responses: {
            /** @description 原子批量移动素材 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BatchMoveAssetsResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    listProjects: {
        parameters: {
            query?: {
                /** @description Opaque signed cursor binding tenant, sort and filters; invalid/expired cursor returns 400. Never accepts SQL offsets or resource ownership through cursor. */
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
                archived?: boolean;
                q?: string;
            };
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 分页列出相册项目 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ListProjectsResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    createProject: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ProjectCreate"];
            };
        };
        responses: {
            /** @description 创建相册与首个版本 */
            201: {
                headers: {
                    "X-Request-Id"?: string;
                    /** @description Quoted current revision for subsequent CAS. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreateProjectResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    getProject: {
        parameters: {
            query?: {
                revision?: number;
            };
            header?: never;
            path: {
                projectId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 读取指定或当前文档版本 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    /** @description Quoted current revision for subsequent CAS. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GetProjectResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    trashProject: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /**
                 * @description Required CAS header: exactly quoted decimal resource revision, e.g. "12". Missing 428; stale 409 REVISION_CONFLICT. Must not use wildcard or timestamps.
                 * @example "12"
                 */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                projectId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 回收项目保留任务快照 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TrashProjectResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    patchProject: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /**
                 * @description Required CAS header: exactly quoted decimal resource revision, e.g. "12". Missing 428; stale 409 REVISION_CONFLICT. Must not use wildcard or timestamps.
                 * @example "12"
                 */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                projectId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "commandId": "cmd_demo",
                 *       "clientPlatform": "mini",
                 *       "commands": [
                 *         {
                 *           "type": "setText",
                 *           "spreadId": "spr_demo",
                 *           "layerId": "layer_demo",
                 *           "text": "我们的旅行"
                 *         }
                 *       ]
                 *     }
                 */
                "application/json": components["schemas"]["ProjectPatch"];
            };
        };
        responses: {
            /** @description CAS保存跨端命令生成新版本 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    /** @description Quoted current revision for subsequent CAS. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PatchProjectResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    updateProjectMetadata: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /**
                 * @description Required CAS header: exactly quoted decimal resource revision, e.g. "12". Missing 428; stale 409 REVISION_CONFLICT. Must not use wildcard or timestamps.
                 * @example "12"
                 */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                projectId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ProjectMetadataUpdate"];
            };
        };
        responses: {
            /** @description CAS更新项目名称与归档 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    /** @description Quoted current revision for subsequent CAS. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UpdateProjectMetadataResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    listProjectRevisions: {
        parameters: {
            query?: {
                /** @description Opaque signed cursor binding tenant, sort and filters; invalid/expired cursor returns 400. Never accepts SQL offsets or resource ownership through cursor. */
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
            };
            header?: never;
            path: {
                projectId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 读取不可变版本历史 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ListProjectRevisionsResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    restoreProjectRevision: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /**
                 * @description Required CAS header: exactly quoted decimal resource revision, e.g. "12". Missing 428; stale 409 REVISION_CONFLICT. Must not use wildcard or timestamps.
                 * @example "12"
                 */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                projectId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RestoreRevision"];
            };
        };
        responses: {
            /** @description 恢复旧内容为新版本 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    /** @description Quoted current revision for subsequent CAS. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RestoreProjectRevisionResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    listTemplates: {
        parameters: {
            query: {
                /** @description Opaque signed cursor binding tenant, sort and filters; invalid/expired cursor returns 400. Never accepts SQL offsets or resource ownership through cursor. */
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
                workspaceId: string;
                scene?: "wedding" | "travel" | "portrait" | "family" | "ink" | "other";
                ratio?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 列出可见模板与许可 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ListTemplatesResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    getTemplate: {
        parameters: {
            query: {
                workspaceId: string;
            };
            header?: never;
            path: {
                templateVersionId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 读取不可变模板版本 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GetTemplateResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    listFonts: {
        parameters: {
            query: {
                /** @description Opaque signed cursor binding tenant, sort and filters; invalid/expired cursor returns 400. Never accepts SQL offsets or resource ownership through cursor. */
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
                workspaceId: string;
                q?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 列出许可字体版本 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ListFontsResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    getFont: {
        parameters: {
            query: {
                workspaceId: string;
            };
            header?: never;
            path: {
                fontAssetId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 读取字体授权与字形覆盖 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GetFontResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    createFontDownloadToken: {
        parameters: {
            query: {
                workspaceId: string;
            };
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                fontAssetId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 签发许可范围内的字体加载令牌 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreateFontDownloadTokenResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    getFilterManifest: {
        parameters: {
            query?: {
                version?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 读取锁定33滤镜manifest */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GetFilterManifestResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    createLayoutJob: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                projectId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LayoutJobCreate"];
            };
        };
        responses: {
            /** @description 创建确定性规则排版候选任务 */
            202: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreateLayoutJobResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    listLayoutCandidates: {
        parameters: {
            query?: {
                /** @description Opaque signed cursor binding tenant, sort and filters; invalid/expired cursor returns 400. Never accepts SQL offsets or resource ownership through cursor. */
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
            };
            header?: never;
            path: {
                jobId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 读取排版候选 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ListLayoutCandidatesResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    applyLayout: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /**
                 * @description Required CAS header: exactly quoted decimal resource revision, e.g. "12". Missing 428; stale 409 REVISION_CONFLICT. Must not use wildcard or timestamps.
                 * @example "12"
                 */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                projectId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ApplyLayout"];
            };
        };
        responses: {
            /** @description CAS应用选中排版候选 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    /** @description Quoted current revision for subsequent CAS. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApplyLayoutResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    listGenerationPresets: {
        parameters: {
            query: {
                /** @description Opaque signed cursor binding tenant, sort and filters; invalid/expired cursor returns 400. Never accepts SQL offsets or resource ownership through cursor. */
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
                workspaceId: string;
                capability?: "textToImage" | "imageToImage";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 列出已验证生图风格与参数能力 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ListGenerationPresetsResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    createGenerationQuote: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "workspaceId": "ws_demo",
                 *       "presetVersionId": "preset_demo",
                 *       "capability": "textToImage",
                 *       "description": "原创山水水墨画，留白",
                 *       "ratio": "1:1",
                 *       "imageCount": 1
                 *     }
                 */
                "application/json": components["schemas"]["GenerationInput"];
            };
        };
        responses: {
            /** @description 冻结输入与版本生成点数报价 */
            201: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreateGenerationQuoteResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    getGenerationQuote: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                quoteId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 查询本人工作区生图报价 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GetGenerationQuoteResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    createGenerationJob: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "quoteId": "quote_demo",
                 *       "inputHash": "0000000000000000000000000000000000000000000000000000000000000000",
                 *       "policyConsentVersion": "policy_demo"
                 *     }
                 */
                "application/json": components["schemas"]["GenerationJobCreate"];
            };
        };
        responses: {
            /** @description 接受报价并原子预占点数与采购预算 */
            202: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreateGenerationJobResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    listWorkspaceJobs: {
        parameters: {
            query?: {
                /** @description Opaque signed cursor binding tenant, sort and filters; invalid/expired cursor returns 400. Never accepts SQL offsets or resource ownership through cursor. */
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
                kind?: "layout" | "generation" | "export" | "privacy_export";
                state?: "queued" | "running" | "succeeded" | "failed" | "cancelled";
            };
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 列出工作区任务 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ListWorkspaceJobsResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    getJob: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                jobId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 查询数据库权威任务状态 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GetJobResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    cancelJob: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                jobId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CancelJob"];
            };
        };
        responses: {
            /** @description 请求任务取消并处理终态竞争 */
            202: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CancelJobResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    retryJob: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                jobId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RetryJob"];
            };
        };
        responses: {
            /** @description 创建关联的合法重试任务 */
            202: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RetryJobResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    getEntitlements: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 读取工作区权益及点数预占 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GetEntitlementsResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    listCreditLedger: {
        parameters: {
            query?: {
                /** @description Opaque signed cursor binding tenant, sort and filters; invalid/expired cursor returns 400. Never accepts SQL offsets or resource ownership through cursor. */
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
            };
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 分页查询追加式点数流水 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ListCreditLedgerResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    listSkus: {
        parameters: {
            query: {
                /** @description Opaque signed cursor binding tenant, sort and filters; invalid/expired cursor returns 400. Never accepts SQL offsets or resource ownership through cursor. */
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
                platform: "web" | "mini";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 读取可售商品不可变版本 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ListSkusResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    createOrder: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "workspaceId": "ws_demo",
                 *       "skuVersionId": "sku_demo",
                 *       "channel": "wechat_pay",
                 *       "clientPlatform": "web"
                 *     }
                 */
                "application/json": components["schemas"]["OrderCreate"];
            };
        };
        responses: {
            /** @description 服务端定价创建订单 */
            201: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreateOrderResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    listOrders: {
        parameters: {
            query?: {
                /** @description Opaque signed cursor binding tenant, sort and filters; invalid/expired cursor returns 400. Never accepts SQL offsets or resource ownership through cursor. */
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
            };
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 查询工作区订单 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ListOrdersResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    getOrder: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                orderId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 查询订单权威状态与履约 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GetOrderResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    createPaymentAttempt: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                orderId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PaymentAttemptCreate"];
            };
        };
        responses: {
            /** @description 创建支付尝试并获取渠道参数 */
            201: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreatePaymentAttemptResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    closeOrder: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /**
                 * @description Required CAS header: exactly quoted decimal resource revision, e.g. "12". Missing 428; stale 409 REVISION_CONFLICT. Must not use wildcard or timestamps.
                 * @example "12"
                 */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                orderId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 关闭尚未支付订单 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CloseOrderResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    requestRefund: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /**
                 * @description Fresh purpose-bound server-issued proof; required for privileged secret/financial/ownership/deletion actions; never logged.
                 * @example demo_key_0000000000000001
                 */
                "X-Reauthentication-Proof": components["parameters"]["ReauthenticationProof"];
            };
            path: {
                orderId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RefundCreate"];
            };
        };
        responses: {
            /** @description 创建原子退款申请 */
            202: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RequestRefundResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    getRefund: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                refundId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 查询退款与权益回收状态 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GetRefundResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    redeemCode: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RedemptionCreate"];
            };
        };
        responses: {
            /** @description 原子兑换权益与点数 */
            201: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RedeemCodeResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    listRedemptions: {
        parameters: {
            query?: {
                /** @description Opaque signed cursor binding tenant, sort and filters; invalid/expired cursor returns 400. Never accepts SQL offsets or resource ownership through cursor. */
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
            };
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 查询工作区兑换记录 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ListRedemptionsResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    createPreflight: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                projectId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "revision": 12,
                 *       "exportSpec": {
                 *         "format": "jpeg",
                 *         "dpi": 300,
                 *         "view": "spread",
                 *         "pageIds": [
                 *           "spr_demo"
                 *         ],
                 *         "includeCover": false,
                 *         "bleedMm": 3,
                 *         "jpegMatte": "#FFFFFF"
                 *       }
                 *     }
                 */
                "application/json": components["schemas"]["PreflightRequest"];
            };
        };
        responses: {
            /** @description 检查打印规格与资源输出预算 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreatePreflightResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    createExportJob: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "workspaceId": "ws_demo",
                 *       "projectId": "prj_demo",
                 *       "revision": 12,
                 *       "preflightToken": "DEMO_TOKEN_NOT_A_CREDENTIAL_000000",
                 *       "normalizedSpecHash": "0000000000000000000000000000000000000000000000000000000000000000",
                 *       "warningsAcknowledged": []
                 *     }
                 */
                "application/json": components["schemas"]["ExportJobCreate"];
            };
        };
        responses: {
            /** @description 冻结预检快照创建导出任务 */
            202: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreateExportJobResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    listJobOutputs: {
        parameters: {
            query?: {
                /** @description Opaque signed cursor binding tenant, sort and filters; invalid/expired cursor returns 400. Never accepts SQL offsets or resource ownership through cursor. */
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
            };
            header?: never;
            path: {
                jobId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 读取任务已发布私有输出 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ListJobOutputsResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    getOutput: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                outputId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 读取私有产物元信息 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GetOutputResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    createOutputDownloadToken: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                outputId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 签发5分钟私有产物下载 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreateOutputDownloadTokenResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    listShares: {
        parameters: {
            query?: {
                /** @description Opaque signed cursor binding tenant, sort and filters; invalid/expired cursor returns 400. Never accepts SQL offsets or resource ownership through cursor. */
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
            };
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 列出工作区分享 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ListSharesResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    createShare: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "outputIds": [
                 *         "out_demo"
                 *       ],
                 *       "expiresInHours": 24,
                 *       "allowDownload": true,
                 *       "accessMode": "link"
                 *     }
                 */
                "application/json": components["schemas"]["ShareCreate"];
            };
        };
        responses: {
            /** @description 创建只读输出分享 */
            201: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreateShareResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    getShare: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                shareId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 读取分享管理信息 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GetShareResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    revokeShare: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /**
                 * @description Required CAS header: exactly quoted decimal resource revision, e.g. "12". Missing 428; stale 409 REVISION_CONFLICT. Must not use wildcard or timestamps.
                 * @example "12"
                 */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                shareId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 撤销分享防止新下载令牌 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RevokeShareResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    accessPublicShare: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                shareToken: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ShareAccess"];
            };
        };
        responses: {
            /** @description 验证公开分享和可选口令 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AccessPublicShareResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    createSharedDownloadToken: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                shareToken: string;
                outputId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 验证分享范围后签发下载 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreateSharedDownloadTokenResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    listNotifications: {
        parameters: {
            query?: {
                /** @description Opaque signed cursor binding tenant, sort and filters; invalid/expired cursor returns 400. Never accepts SQL offsets or resource ownership through cursor. */
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 分页列出本人站内通知 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ListNotificationsResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    markNotificationRead: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                notificationId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["NotificationUpdate"];
            };
        };
        responses: {
            /** @description 标记本人通知已读 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MarkNotificationReadResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    setNotificationSubscription: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["NotifySubscription"];
            };
        };
        responses: {
            /** @description 记录小程序一次性订阅同意 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SetNotificationSubscriptionResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    listConfigDrafts: {
        parameters: {
            query?: {
                /** @description Opaque signed cursor binding tenant, sort and filters; invalid/expired cursor returns 400. Never accepts SQL offsets or resource ownership through cursor. */
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
                category?: "storage" | "aiConnection" | "auth" | "payment" | "sku" | "editor" | "layout" | "export" | "queue" | "content" | "share" | "notification" | "retention" | "monitor" | "workspace" | "account" | "site" | "upload" | "aiRoute" | "aiPricing" | "albumDefaults";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 列出本环境配置草稿 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ListConfigDraftsResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    createConfigDraft: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ConfigDraftCreate"];
            };
        };
        responses: {
            /** @description 从版本创建配置草稿 */
            201: {
                headers: {
                    "X-Request-Id"?: string;
                    /** @description Quoted current revision for subsequent CAS. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreateConfigDraftResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    getConfigDraft: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                draftId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 读取不含明文秘密的草稿 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    /** @description Quoted current revision for subsequent CAS. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GetConfigDraftResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    replaceConfigDraft: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /**
                 * @description Required CAS header: exactly quoted decimal resource revision, e.g. "12". Missing 428; stale 409 REVISION_CONFLICT. Must not use wildcard or timestamps.
                 * @example "12"
                 */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                draftId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ConfigDraftUpdate"];
            };
        };
        responses: {
            /** @description CAS替换类型化配置草稿 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    /** @description Quoted current revision for subsequent CAS. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ReplaceConfigDraftResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    discardConfigDraft: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /**
                 * @description Required CAS header: exactly quoted decimal resource revision, e.g. "12". Missing 428; stale 409 REVISION_CONFLICT. Must not use wildcard or timestamps.
                 * @example "12"
                 */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                draftId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description CAS丢弃未发布草稿 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DiscardConfigDraftResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    createConfigTest: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /**
                 * @description Required CAS header: exactly quoted decimal resource revision, e.g. "12". Missing 428; stale 409 REVISION_CONFLICT. Must not use wildcard or timestamps.
                 * @example "12"
                 */
                "If-Match": components["parameters"]["IfMatch"];
                /**
                 * @description Fresh purpose-bound server-issued proof; required for privileged secret/financial/ownership/deletion actions; never logged.
                 * @example demo_key_0000000000000001
                 */
                "X-Reauthentication-Proof": components["parameters"]["ReauthenticationProof"];
            };
            path: {
                draftId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ConfigTestCreate"];
            };
        };
        responses: {
            /** @description 启动有边界的分层配置测试 */
            202: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreateConfigTestResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    getConfigTest: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                testId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 读取实际验证层级与5分钟有效期 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GetConfigTestResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    getConfigImpact: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                draftId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 预览配置发布影响与缺失检查 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GetConfigImpactResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    publishConfig: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /**
                 * @description Required CAS header: exactly quoted decimal resource revision, e.g. "12". Missing 428; stale 409 REVISION_CONFLICT. Must not use wildcard or timestamps.
                 * @example "12"
                 */
                "If-Match": components["parameters"]["IfMatch"];
                /**
                 * @description Fresh purpose-bound server-issued proof; required for privileged secret/financial/ownership/deletion actions; never logged.
                 * @example demo_key_0000000000000001
                 */
                "X-Reauthentication-Proof": components["parameters"]["ReauthenticationProof"];
            };
            path: {
                draftId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ConfigPublish"];
            };
        };
        responses: {
            /** @description 原子发布已测试配置 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    /** @description Quoted current revision for subsequent CAS. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublishConfigResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    listConfigReleases: {
        parameters: {
            query?: {
                /** @description Opaque signed cursor binding tenant, sort and filters; invalid/expired cursor returns 400. Never accepts SQL offsets or resource ownership through cursor. */
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 读取不可变发布历史 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ListConfigReleasesResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    getConfigRelease: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                releaseId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 读取发布组成 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    /** @description Quoted current revision for subsequent CAS. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GetConfigReleaseResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    rollbackConfig: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /**
                 * @description Fresh purpose-bound server-issued proof; required for privileged secret/financial/ownership/deletion actions; never logged.
                 * @example demo_key_0000000000000001
                 */
                "X-Reauthentication-Proof": components["parameters"]["ReauthenticationProof"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ConfigRollback"];
            };
        };
        responses: {
            /** @description 复验后重新发布旧配置组合 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    /** @description Quoted current revision for subsequent CAS. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RollbackConfigResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    emergencyDisableCapability: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /**
                 * @description Fresh purpose-bound server-issued proof; required for privileged secret/financial/ownership/deletion actions; never logged.
                 * @example demo_key_0000000000000001
                 */
                "X-Reauthentication-Proof": components["parameters"]["ReauthenticationProof"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["EmergencyDisable"];
            };
        };
        responses: {
            /** @description 审计式紧急停用新请求 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EmergencyDisableCapabilityResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    listSecretMetadata: {
        parameters: {
            query?: {
                /** @description Opaque signed cursor binding tenant, sort and filters; invalid/expired cursor returns 400. Never accepts SQL offsets or resource ownership through cursor. */
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 仅列出秘密掩码与版本元数据 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ListSecretMetadataResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    createSecret: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /**
                 * @description Fresh purpose-bound server-issued proof; required for privileged secret/financial/ownership/deletion actions; never logged.
                 * @example demo_key_0000000000000001
                 */
                "X-Reauthentication-Proof": components["parameters"]["ReauthenticationProof"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SecretCreate"];
            };
        };
        responses: {
            /** @description 写入加密秘密新版本 */
            201: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreateSecretResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    rotateSecret: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /**
                 * @description Fresh purpose-bound server-issued proof; required for privileged secret/financial/ownership/deletion actions; never logged.
                 * @example demo_key_0000000000000001
                 */
                "X-Reauthentication-Proof": components["parameters"]["ReauthenticationProof"];
            };
            path: {
                secretId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SecretRotate"];
            };
        };
        responses: {
            /** @description 创建秘密轮换待测版本 */
            201: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RotateSecretResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    revokeSecret: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /**
                 * @description Fresh purpose-bound server-issued proof; required for privileged secret/financial/ownership/deletion actions; never logged.
                 * @example demo_key_0000000000000001
                 */
                "X-Reauthentication-Proof": components["parameters"]["ReauthenticationProof"];
            };
            path: {
                secretId: string;
                secretVersionId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SecretRevoke"];
            };
        };
        responses: {
            /** @description 检查活动引用后撤销凭据版本 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RevokeSecretResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    listProviderContracts: {
        parameters: {
            query?: {
                /** @description Opaque signed cursor binding tenant, sort and filters; invalid/expired cursor returns 400. Never accepts SQL offsets or resource ownership through cursor. */
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 读取允许适配器的能力契约 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ListProviderContractsResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    listStorageProfilesUsage: {
        parameters: {
            query?: {
                /** @description Opaque signed cursor binding tenant, sort and filters; invalid/expired cursor returns 400. Never accepts SQL offsets or resource ownership through cursor. */
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 查询各存储版本对象与pin */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ListStorageProfilesUsageResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    previewStoragePath: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["StoragePathPreview"];
            };
        };
        responses: {
            /** @description 展开固定规则的新写入对象路径 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PreviewStoragePathResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    planStorageMigration: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MigrationPlanCreate"];
            };
        };
        responses: {
            /** @description 计算历史迁移范围与成本上限 */
            201: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PlanStorageMigrationResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    startStorageMigration: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /**
                 * @description Fresh purpose-bound server-issued proof; required for privileged secret/financial/ownership/deletion actions; never logged.
                 * @example demo_key_0000000000000001
                 */
                "X-Reauthentication-Proof": components["parameters"]["ReauthenticationProof"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MigrationStart"];
            };
        };
        responses: {
            /** @description 开始可恢复校验与locator条件迁移 */
            202: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StartStorageMigrationResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    getStorageMigration: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                jobId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 查询迁移检查点状态 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GetStorageMigrationResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    publishContentVersion: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /**
                 * @description Fresh purpose-bound server-issued proof; required for privileged secret/financial/ownership/deletion actions; never logged.
                 * @example demo_key_0000000000000001
                 */
                "X-Reauthentication-Proof": components["parameters"]["ReauthenticationProof"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ContentPublication"];
            };
        };
        responses: {
            /** @description 审查许可证后发布不可变内容版本 */
            201: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublishContentVersionResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    retireContentVersion: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /**
                 * @description Required CAS header: exactly quoted decimal resource revision, e.g. "12". Missing 428; stale 409 REVISION_CONFLICT. Must not use wildcard or timestamps.
                 * @example "12"
                 */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                versionId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ContentRetire"];
            };
        };
        responses: {
            /** @description 退役内容新引用并保留历史证据 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RetireContentVersionResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    decideRefund: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /**
                 * @description Fresh purpose-bound server-issued proof; required for privileged secret/financial/ownership/deletion actions; never logged.
                 * @example demo_key_0000000000000001
                 */
                "X-Reauthentication-Proof": components["parameters"]["ReauthenticationProof"];
            };
            path: {
                refundId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminDecision"];
            };
        };
        responses: {
            /** @description 财务审核退款后提交渠道 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DecideRefundResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    listRedemptionBatches: {
        parameters: {
            query?: {
                /** @description Opaque signed cursor binding tenant, sort and filters; invalid/expired cursor returns 400. Never accepts SQL offsets or resource ownership through cursor. */
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 列出兑换批次不含原始码 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ListRedemptionBatchesResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    createRedemptionBatch: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /**
                 * @description Fresh purpose-bound server-issued proof; required for privileged secret/financial/ownership/deletion actions; never logged.
                 * @example demo_key_0000000000000001
                 */
                "X-Reauthentication-Proof": components["parameters"]["ReauthenticationProof"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RedemptionBatchCreate"];
            };
        };
        responses: {
            /** @description 创建只存哈希的兑换码批次 */
            201: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreateRedemptionBatchResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    disableRedemptionBatch: {
        parameters: {
            query: {
                /** @description Operator reason for disabling new claims; retained in the redacted audit. Do not log query values. */
                reason: string;
            };
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /**
                 * @description Required CAS header: exactly quoted decimal resource revision, e.g. "12". Missing 428; stale 409 REVISION_CONFLICT. Must not use wildcard or timestamps.
                 * @example "12"
                 */
                "If-Match": components["parameters"]["IfMatch"];
                /**
                 * @description Fresh purpose-bound server-issued proof; required for privileged secret/financial/ownership/deletion actions; never logged.
                 * @example demo_key_0000000000000001
                 */
                "X-Reauthentication-Proof": components["parameters"]["ReauthenticationProof"];
            };
            path: {
                batchId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 停用批次而不撤销既有兑换 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DisableRedemptionBatchResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    listAuditEvents: {
        parameters: {
            query?: {
                /** @description Opaque signed cursor binding tenant, sort and filters; invalid/expired cursor returns 400. Never accepts SQL offsets or resource ownership through cursor. */
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
                actorId?: string;
                targetId?: string;
                action?: string;
                from?: string;
                to?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 查询不可修改审计事件 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ListAuditEventsResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    queryAdminJobs: {
        parameters: {
            query?: {
                /** @description Opaque signed cursor binding tenant, sort and filters; invalid/expired cursor returns 400. Never accepts SQL offsets or resource ownership through cursor. */
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
                workspaceId?: string;
                state?: string;
                kind?: string;
                from?: string;
                to?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 跨工作区受审计任务检索 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["QueryAdminJobsResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    adminJobAction: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /**
                 * @description Fresh purpose-bound server-issued proof; required for privileged secret/financial/ownership/deletion actions; never logged.
                 * @example demo_key_0000000000000001
                 */
                "X-Reauthentication-Proof": components["parameters"]["ReauthenticationProof"];
            };
            path: {
                jobId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminJobAction"];
            };
        };
        responses: {
            /** @description 执行受限任务恢复动作 */
            202: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminJobActionResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    queryAdminOrders: {
        parameters: {
            query?: {
                /** @description Opaque signed cursor binding tenant, sort and filters; invalid/expired cursor returns 400. Never accepts SQL offsets or resource ownership through cursor. */
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
                workspaceId?: string;
                state?: "pending" | "paid" | "closed" | "refund_pending" | "partially_refunded" | "refunded";
                from?: string;
                to?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 财务订单查询 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["QueryAdminOrdersResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    queryAdminRefunds: {
        parameters: {
            query?: {
                /** @description Opaque signed cursor binding tenant, sort and filters; invalid/expired cursor returns 400. Never accepts SQL offsets or resource ownership through cursor. */
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
                workspaceId?: string;
                from?: string;
                to?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 财务退款查询 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["QueryAdminRefundsResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    getOperationsStatus: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 读取按能力分开的上线就绪与监控 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GetOperationsStatusResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    startReconciliation: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /**
                 * @description Fresh purpose-bound server-issued proof; required for privileged secret/financial/ownership/deletion actions; never logged.
                 * @example demo_key_0000000000000001
                 */
                "X-Reauthentication-Proof": components["parameters"]["ReauthenticationProof"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReconcileRequest"];
            };
        };
        responses: {
            /** @description 启动受控事实核对 */
            202: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StartReconciliationResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    getReconciliation: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                reconciliationId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 读取脱敏对账结果 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GetReconciliationResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    createBackupRestoreDrill: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /**
                 * @description Fresh purpose-bound server-issued proof; required for privileged secret/financial/ownership/deletion actions; never logged.
                 * @example demo_key_0000000000000001
                 */
                "X-Reauthentication-Proof": components["parameters"]["ReauthenticationProof"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BackupDrillCreate"];
            };
        };
        responses: {
            /** @description 隔离环境恢复备份验证任务 */
            202: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreateBackupRestoreDrillResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    receivePaymentCallback: {
        parameters: {
            query?: never;
            header?: {
                /** @description Adapter-mandatory original header; required header set depends on registered adapter/channel. Reject if any adapter-required header absent; header parameters cannot express cross-header OR conditions. */
                "Wechatpay-Timestamp"?: string;
                /** @description Adapter-mandatory original header; required header set depends on registered adapter/channel. Reject if any adapter-required header absent; header parameters cannot express cross-header OR conditions. */
                "Wechatpay-Nonce"?: string;
                /** @description Adapter-mandatory original header; required header set depends on registered adapter/channel. Reject if any adapter-required header absent; header parameters cannot express cross-header OR conditions. */
                "Wechatpay-Serial"?: string;
                /** @description Adapter-mandatory original header; required header set depends on registered adapter/channel. Reject if any adapter-required header absent; header parameters cannot express cross-header OR conditions. */
                "Wechatpay-Signature"?: string;
                /** @description Adapter-mandatory original header; required header set depends on registered adapter/channel. Reject if any adapter-required header absent; header parameters cannot express cross-header OR conditions. */
                "X-Callback-Timestamp"?: string;
                /** @description Adapter-mandatory original header; required header set depends on registered adapter/channel. Reject if any adapter-required header absent; header parameters cannot express cross-header OR conditions. */
                "X-Callback-Nonce"?: string;
                /** @description Adapter-mandatory original header; required header set depends on registered adapter/channel. Reject if any adapter-required header absent; header parameters cannot express cross-header OR conditions. */
                "X-Callback-Key-Id"?: string;
                /** @description Adapter-mandatory original header; required header set depends on registered adapter/channel. Reject if any adapter-required header absent; header parameters cannot express cross-header OR conditions. */
                "X-Callback-Signature"?: string;
            };
            path: {
                channel: "wechat_pay" | "wechat_virtual";
            };
            cookie?: never;
        };
        /** @description Exact raw UTF-8 JSON bytes on wire. Capture original byte buffer and original signed headers BEFORE decode/parse; schema validates only after successful cryptographic verification. Max body1MiB. WeChat Pay encrypted fields decrypted only after outer signature validation. */
        requestBody: {
            content: {
                "application/json": components["schemas"]["WechatEncryptedCallback"] | components["schemas"]["RegisteredCallbackEnvelope"];
            };
        };
        responses: {
            /** @description After durable verified event transaction, emit the configured adapter exact acknowledgment; not the normal API envelope. WeChat Pay uses JSON code SUCCESS/message 成功. Provider acknowledgments fixed by verified adapter, never arbitrary echoed body. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CallbackAck"];
                    /** @example success */
                    "text/plain": string;
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            503: components["responses"]["Unavailable"];
        };
    };
    receiveRefundCallback: {
        parameters: {
            query?: never;
            header?: {
                /** @description Adapter-mandatory original header; required header set depends on registered adapter/channel. Reject if any adapter-required header absent; header parameters cannot express cross-header OR conditions. */
                "Wechatpay-Timestamp"?: string;
                /** @description Adapter-mandatory original header; required header set depends on registered adapter/channel. Reject if any adapter-required header absent; header parameters cannot express cross-header OR conditions. */
                "Wechatpay-Nonce"?: string;
                /** @description Adapter-mandatory original header; required header set depends on registered adapter/channel. Reject if any adapter-required header absent; header parameters cannot express cross-header OR conditions. */
                "Wechatpay-Serial"?: string;
                /** @description Adapter-mandatory original header; required header set depends on registered adapter/channel. Reject if any adapter-required header absent; header parameters cannot express cross-header OR conditions. */
                "Wechatpay-Signature"?: string;
                /** @description Adapter-mandatory original header; required header set depends on registered adapter/channel. Reject if any adapter-required header absent; header parameters cannot express cross-header OR conditions. */
                "X-Callback-Timestamp"?: string;
                /** @description Adapter-mandatory original header; required header set depends on registered adapter/channel. Reject if any adapter-required header absent; header parameters cannot express cross-header OR conditions. */
                "X-Callback-Nonce"?: string;
                /** @description Adapter-mandatory original header; required header set depends on registered adapter/channel. Reject if any adapter-required header absent; header parameters cannot express cross-header OR conditions. */
                "X-Callback-Key-Id"?: string;
                /** @description Adapter-mandatory original header; required header set depends on registered adapter/channel. Reject if any adapter-required header absent; header parameters cannot express cross-header OR conditions. */
                "X-Callback-Signature"?: string;
            };
            path: {
                channel: "wechat_pay" | "wechat_virtual";
            };
            cookie?: never;
        };
        /** @description Exact raw UTF-8 JSON bytes on wire. Capture original byte buffer and original signed headers BEFORE decode/parse; schema validates only after successful cryptographic verification. Max body1MiB. WeChat Pay encrypted fields decrypted only after outer signature validation. */
        requestBody: {
            content: {
                "application/json": components["schemas"]["WechatEncryptedCallback"] | components["schemas"]["RegisteredCallbackEnvelope"];
            };
        };
        responses: {
            /** @description After durable verified event transaction, emit the configured adapter exact acknowledgment; not the normal API envelope. WeChat Pay uses JSON code SUCCESS/message 成功. Provider acknowledgments fixed by verified adapter, never arbitrary echoed body. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CallbackAck"];
                    /** @example success */
                    "text/plain": string;
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            503: components["responses"]["Unavailable"];
        };
    };
    receiveProviderCallback: {
        parameters: {
            query?: never;
            header?: {
                /** @description Adapter-mandatory original header; required header set depends on registered adapter/channel. Reject if any adapter-required header absent; header parameters cannot express cross-header OR conditions. */
                "Wechatpay-Timestamp"?: string;
                /** @description Adapter-mandatory original header; required header set depends on registered adapter/channel. Reject if any adapter-required header absent; header parameters cannot express cross-header OR conditions. */
                "Wechatpay-Nonce"?: string;
                /** @description Adapter-mandatory original header; required header set depends on registered adapter/channel. Reject if any adapter-required header absent; header parameters cannot express cross-header OR conditions. */
                "Wechatpay-Serial"?: string;
                /** @description Adapter-mandatory original header; required header set depends on registered adapter/channel. Reject if any adapter-required header absent; header parameters cannot express cross-header OR conditions. */
                "Wechatpay-Signature"?: string;
                /** @description Adapter-mandatory original header; required header set depends on registered adapter/channel. Reject if any adapter-required header absent; header parameters cannot express cross-header OR conditions. */
                "X-Callback-Timestamp"?: string;
                /** @description Adapter-mandatory original header; required header set depends on registered adapter/channel. Reject if any adapter-required header absent; header parameters cannot express cross-header OR conditions. */
                "X-Callback-Nonce"?: string;
                /** @description Adapter-mandatory original header; required header set depends on registered adapter/channel. Reject if any adapter-required header absent; header parameters cannot express cross-header OR conditions. */
                "X-Callback-Key-Id"?: string;
                /** @description Adapter-mandatory original header; required header set depends on registered adapter/channel. Reject if any adapter-required header absent; header parameters cannot express cross-header OR conditions. */
                "X-Callback-Signature"?: string;
            };
            path: {
                adapterId: string;
            };
            cookie?: never;
        };
        /** @description Exact raw UTF-8 JSON bytes on wire. Capture original byte buffer and original signed headers BEFORE decode/parse; schema validates only after successful cryptographic verification. Max body1MiB. WeChat Pay encrypted fields decrypted only after outer signature validation. */
        requestBody: {
            content: {
                "application/json": components["schemas"]["RegisteredCallbackEnvelope"];
            };
        };
        responses: {
            /** @description After durable verified event transaction, emit the configured adapter exact acknowledgment; not the normal API envelope. WeChat Pay uses JSON code SUCCESS/message 成功. Provider acknowledgments fixed by verified adapter, never arbitrary echoed body. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CallbackAck"];
                    /** @example success */
                    "text/plain": string;
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            503: components["responses"]["Unavailable"];
        };
    };
    receiveNotificationCallback: {
        parameters: {
            query?: never;
            header?: {
                /** @description Adapter-mandatory original header; required header set depends on registered adapter/channel. Reject if any adapter-required header absent; header parameters cannot express cross-header OR conditions. */
                "Wechatpay-Timestamp"?: string;
                /** @description Adapter-mandatory original header; required header set depends on registered adapter/channel. Reject if any adapter-required header absent; header parameters cannot express cross-header OR conditions. */
                "Wechatpay-Nonce"?: string;
                /** @description Adapter-mandatory original header; required header set depends on registered adapter/channel. Reject if any adapter-required header absent; header parameters cannot express cross-header OR conditions. */
                "Wechatpay-Serial"?: string;
                /** @description Adapter-mandatory original header; required header set depends on registered adapter/channel. Reject if any adapter-required header absent; header parameters cannot express cross-header OR conditions. */
                "Wechatpay-Signature"?: string;
                /** @description Adapter-mandatory original header; required header set depends on registered adapter/channel. Reject if any adapter-required header absent; header parameters cannot express cross-header OR conditions. */
                "X-Callback-Timestamp"?: string;
                /** @description Adapter-mandatory original header; required header set depends on registered adapter/channel. Reject if any adapter-required header absent; header parameters cannot express cross-header OR conditions. */
                "X-Callback-Nonce"?: string;
                /** @description Adapter-mandatory original header; required header set depends on registered adapter/channel. Reject if any adapter-required header absent; header parameters cannot express cross-header OR conditions. */
                "X-Callback-Key-Id"?: string;
                /** @description Adapter-mandatory original header; required header set depends on registered adapter/channel. Reject if any adapter-required header absent; header parameters cannot express cross-header OR conditions. */
                "X-Callback-Signature"?: string;
            };
            path: {
                adapterId: string;
            };
            cookie?: never;
        };
        /** @description Exact raw UTF-8 JSON bytes on wire. Capture original byte buffer and original signed headers BEFORE decode/parse; schema validates only after successful cryptographic verification. Max body1MiB. WeChat Pay encrypted fields decrypted only after outer signature validation. */
        requestBody: {
            content: {
                "application/json": components["schemas"]["RegisteredCallbackEnvelope"];
            };
        };
        responses: {
            /** @description After durable verified event transaction, emit the configured adapter exact acknowledgment; not the normal API envelope. WeChat Pay uses JSON code SUCCESS/message 成功. Provider acknowledgments fixed by verified adapter, never arbitrary echoed body. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CallbackAck"];
                    /** @example success */
                    "text/plain": string;
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            503: components["responses"]["Unavailable"];
        };
    };
    reauthenticate: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReauthenticateRequest"];
            };
        };
        responses: {
            /** @description 通过新身份挑战获取目的绑定操作证明 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ReauthenticateResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    restoreProject: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /**
                 * @description Required CAS header: exactly quoted decimal resource revision, e.g. "12". Missing 428; stale 409 REVISION_CONFLICT. Must not use wildcard or timestamps.
                 * @example "12"
                 */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                projectId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 恢复回收站项目 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    /** @description Quoted current revision for subsequent CAS. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RestoreProjectResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    healthLive: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 进程存活探针 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HealthLiveResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    healthReady: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 接收API请求的基础依赖就绪探针 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HealthReadyResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            /** @description 基础依赖不可用，不接收新业务请求。 */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HealthReadyResponse"];
                };
            };
        };
    };
    createAdminContentUpload: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminContentUpload"];
            };
        };
        responses: {
            /** @description 创建有许可的内容暂存上传 */
            201: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreateAdminContentUploadResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    createTemplateVersion: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "name": "国风原创模板演示",
                 *       "scene": "ink",
                 *       "document": {
                 *         "schemaVersion": 1,
                 *         "projectId": "tpl_document_demo",
                 *         "revision": 1,
                 *         "unit": "px96",
                 *         "colorSpace": "srgb",
                 *         "pageSize": {
                 *           "width": 1133.858268,
                 *           "height": 1133.858268
                 *         },
                 *         "printProfile": {
                 *           "bleedMm": 3,
                 *           "safeMm": 5
                 *         },
                 *         "cover": {
                 *           "front": [],
                 *           "back": []
                 *         },
                 *         "spreads": [
                 *           {
                 *             "id": "spr_01",
                 *             "background": "#FFFFFF",
                 *             "layers": [
                 *               {
                 *                 "x": 80,
                 *                 "y": 80,
                 *                 "width": 850,
                 *                 "height": 850,
                 *                 "rotation": 0,
                 *                 "opacity": 1,
                 *                 "visible": true,
                 *                 "locked": false,
                 *                 "id": "image_01",
                 *                 "type": "image",
                 *                 "assetId": "ast_placeholder_demo",
                 *                 "crop": {
                 *                   "x": 0,
                 *                   "y": 0,
                 *                   "width": 0.75,
                 *                   "height": 1
                 *                 },
                 *                 "fitMode": "cover",
                 *                 "role": "photo",
                 *                 "filter": {
                 *                   "presetId": "F07",
                 *                   "recipeVersion": 1,
                 *                   "strength": 0.65,
                 *                   "seed": 1729
                 *                 }
                 *               },
                 *               {
                 *                 "x": 1200,
                 *                 "y": 180,
                 *                 "width": 800,
                 *                 "height": 170,
                 *                 "rotation": 0,
                 *                 "opacity": 1,
                 *                 "visible": true,
                 *                 "locked": false,
                 *                 "id": "text_01",
                 *                 "type": "text",
                 *                 "text": "国风相册",
                 *                 "fontAssetId": "font_demo",
                 *                 "fontSize": 48,
                 *                 "fontWeight": 400,
                 *                 "lineHeight": 1.4,
                 *                 "letterSpacing": 0,
                 *                 "textAlign": "left",
                 *                 "fill": "#243B35",
                 *                 "editableFields": [
                 *                   "text"
                 *                 ]
                 *               }
                 *             ]
                 *           }
                 *         ]
                 *       },
                 *       "slots": [
                 *         {
                 *           "slotId": "photo_demo",
                 *           "spreadId": "spr_01",
                 *           "layerId": "image_01",
                 *           "kind": "image",
                 *           "miniEditableFields": [
                 *             "crop",
                 *             "assetId"
                 *           ],
                 *           "bindingRequired": true,
                 *           "placeholderAssetId": "ast_placeholder_demo"
                 *         },
                 *         {
                 *           "slotId": "title_demo",
                 *           "spreadId": "spr_01",
                 *           "layerId": "text_01",
                 *           "kind": "text",
                 *           "miniEditableFields": [
                 *             "text"
                 *           ],
                 *           "bindingRequired": false
                 *         }
                 *       ],
                 *       "licenseRef": "license_demo",
                 *       "reason": "演示结构，素材和字体须完成实际注册及授权后方可发布"
                 *     }
                 */
                "application/json": components["schemas"]["TemplateVersionCreate"];
            };
        };
        responses: {
            /** @description 创建独立于渲染器的不可变模板版本草稿 */
            201: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreateTemplateVersionResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    createFontVersion: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["FontVersionCreate"];
            };
        };
        responses: {
            /** @description 解析并登记有授权的字体版本草稿 */
            201: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreateFontVersionResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    listContentVersions: {
        parameters: {
            query?: {
                /** @description Opaque signed cursor binding tenant, sort and filters; invalid/expired cursor returns 400. Never accepts SQL offsets or resource ownership through cursor. */
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
                kind?: "template" | "font" | "preset" | "sku" | "filter_manifest";
                state?: "draft" | "review" | "published" | "retired";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 列出待审与已发布内容版本 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ListContentVersionsResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    listLicenseRecords: {
        parameters: {
            query?: {
                /** @description Opaque signed cursor binding tenant, sort and filters; invalid/expired cursor returns 400. Never accepts SQL offsets or resource ownership through cursor. */
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 查询版权证据和有效范围 */
            200: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ListLicenseRecordsResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    createLicenseRecord: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LicenseCreate"];
            };
        };
        responses: {
            /** @description 登记可追溯权利证据 */
            201: {
                headers: {
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreateLicenseRecordResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["PaymentRequired"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Unavailable"];
        };
    };
    createFinancialAdjustment: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Required replay key 16–128 printable ASCII. Workspace scope unique for 7 days across write endpoints; same canonical request/method/path returns original response, different payload returns 409 IDEMPOTENCY_MISMATCH. User scope before workspace selection. Callback dedup uses authenticated provider event ID instead.
                 * @example demo_key_0000000000000001
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /**
                 * @description Fresh purpose-bound server-issued proof; required for privileged secret/financial/ownership/deletion actions; never logged.
                 * @example demo_key_0000000000000001
                 */
                "X-Reauthentication-Proof": components["parameters"]["ReauthenticationProof"];
            };
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["FinancialAdjustmentCreate"];
            };
        };
        responses: {
            /** @description 已记录财务调整 */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FinancialAdjustmentResponse"];
                };
            };
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["Unavailable"];
        };
    };
}
