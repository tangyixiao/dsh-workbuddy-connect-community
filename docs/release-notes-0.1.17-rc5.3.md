# 0.1.17-rc5.3

Publishes the qualified 0.1.17 source as an explicitly selected next preview. It includes the Zod >=4.6.6 runtime floor, Vitest 4.1.12 development patch, current black README banners, character artwork and complete package documentation. Runtime requirements, account/profile formats and supported hosts remain unchanged.

Install the exact preview with `dsh plugin --profile web add dsh-workbuddy-connect-community@0.1.17-rc5.3`. This source branch stays separate from stable main; npm latest remains 0.1.17. The GitHub release is marked prerelease and does not replace the stable latest release.

Source CI, the built preview version, npm channel/tag metadata, exact downloaded artifact hashes and release asset digests are qualified separately. DSH host packages with exact Zod 4.4.3 dependencies still require their own upstream update; the plugin does not patch host archives.
