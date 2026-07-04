# Changelog

## [0.7.0](https://github.com/luxus/pi-hindsight/compare/v0.6.0...v0.7.0) (2026-07-04)


### Features

* add exact tagsMatch mode for recall and reflect from Hindsight 0.8.x ([#449](https://github.com/luxus/pi-hindsight/issues/449)) ([bd6dc9d](https://github.com/luxus/pi-hindsight/commit/bd6dc9d4043cb5d7af0629f1b71f49ff0a4988b7))
* add shared observation scope from Hindsight 0.8.x ([#448](https://github.com/luxus/pi-hindsight/issues/448)) ([52fbad4](https://github.com/luxus/pi-hindsight/commit/52fbad4a56df87b63265b138a6a2637c05919dac))
* adopt Hindsight client 0.8.4 recall options, drop 'opinion' fact type ([#446](https://github.com/luxus/pi-hindsight/issues/446)) ([f1a0095](https://github.com/luxus/pi-hindsight/commit/f1a0095d17a92fe70517bfc6c4844b3239114d59))
* adopt retainStructuredChunkSize bank config from Hindsight 0.8.x ([#447](https://github.com/luxus/pi-hindsight/issues/447)) ([eef92cd](https://github.com/luxus/pi-hindsight/commit/eef92cd0cfcb0eab5e0727e7f68fd4521281d8a0))
* **bench:** add memory-quality benchmark harness over live Hindsight ([ddf7acb](https://github.com/luxus/pi-hindsight/commit/ddf7acbdfc40baa8cefc38da39483ebf83661632))
* **client:** upgrade hindsight-client to 0.8.1 and retire REST shims ([d34cffa](https://github.com/luxus/pi-hindsight/commit/d34cffad08dd1df6a0d386a922cadf8e94139960))
* **diagnostics:** revive /hindsight:doctor command ([#457](https://github.com/luxus/pi-hindsight/issues/457)) ([a430ef6](https://github.com/luxus/pi-hindsight/commit/a430ef6703ecbad41e28aad2578bd1433f4f78c4))
* **diagnostics:** surface connected server version and feature flags ([3ce502d](https://github.com/luxus/pi-hindsight/commit/3ce502d0779c32ebe60bffd67249d33073a19d46))
* **diagnostics:** surface connected server version and feature flags ([4b25732](https://github.com/luxus/pi-hindsight/commit/4b25732673fdf84be78aa0c954f99a2c4ea39c96))
* **diagnostics:** surface connected server version and feature flags ([#441](https://github.com/luxus/pi-hindsight/issues/441)) ([3ce502d](https://github.com/luxus/pi-hindsight/commit/3ce502d0779c32ebe60bffd67249d33073a19d46))
* land slim-core 0.8 rewrite ([#430](https://github.com/luxus/pi-hindsight/issues/430)) ([51776ee](https://github.com/luxus/pi-hindsight/commit/51776ee04eb6812a96ca0b427e44ea9c49693718))
* land slim-core 0.8 rewrite (slim surface + native hindsight-client 0.8) ([51776ee](https://github.com/luxus/pi-hindsight/commit/51776ee04eb6812a96ca0b427e44ea9c49693718))
* **recall:** add recall.userMaxTokens per ADR-004 ([#462](https://github.com/luxus/pi-hindsight/issues/462)) ([75060ad](https://github.com/luxus/pi-hindsight/commit/75060ad77b4a338cdca5b0613dfef9eb07bdc19f))
* **recall:** expose source-fact enrichment in lifecycle recall and formatter ([1693bfd](https://github.com/luxus/pi-hindsight/commit/1693bfde926e39549a9a43808306f54ae7e0ce72))
* **recall:** use tag-group scope isolation for lifecycle recall and tools ([a59b718](https://github.com/luxus/pi-hindsight/commit/a59b71860b8390da3a6488c299839f23455d00f4))
* **reflect:** adopt 0.8 reflect options natively and summarize output ([92400dc](https://github.com/luxus/pi-hindsight/commit/92400dc07463764a6e7e7c6fb20bbf5aa82b86a3))
* **retain:** surface retain outcome metadata in flush, queue, and status ([7e1b9b2](https://github.com/luxus/pi-hindsight/commit/7e1b9b2e96b8479f6c7a0bed3c51b337ae959783))
* support expandable memory tool output ([#444](https://github.com/luxus/pi-hindsight/issues/444)) ([5da82de](https://github.com/luxus/pi-hindsight/commit/5da82ded2b243b8d5499e4e468af91fa56b823d9))


### Bug Fixes

* **ci:** repoint stale coverage include/thresholds after slim-core reorg ([81e3d50](https://github.com/luxus/pi-hindsight/commit/81e3d50e7a7c1664df4b053c8b9573df8969bbcc))
* **ci:** repoint stale coverage include/thresholds after slim-core reorg ([f0dfc27](https://github.com/luxus/pi-hindsight/commit/f0dfc272bd830f75988fba51bc76398a5e63471c))
* **ci:** repoint stale coverage include/thresholds after slim-core reorg ([#442](https://github.com/luxus/pi-hindsight/issues/442)) ([81e3d50](https://github.com/luxus/pi-hindsight/commit/81e3d50e7a7c1664df4b053c8b9573df8969bbcc))
* **client:** remove append capability seam and consolidate retry ([69041be](https://github.com/luxus/pi-hindsight/commit/69041be8cb171a38942476596d63884b6cd3ac43))
* **lifecycle:** record inspectable init health and make recall cache TTL configurable ([3d88772](https://github.com/luxus/pi-hindsight/commit/3d88772266391703a0727b5aacedc1fd6f19865c))
* **observability:** surface best-effort failures in post-retain reflect and lifecycle recall ([#456](https://github.com/luxus/pi-hindsight/issues/456)) ([178aba4](https://github.com/luxus/pi-hindsight/commit/178aba4568dfe7fdb6c51ff71c3f26eae9271a5f))
* **recall:** fold scope tags into exact tagsMatch instead of an unsatisfiable AND ([#451](https://github.com/luxus/pi-hindsight/issues/451)) ([0e0f9a2](https://github.com/luxus/pi-hindsight/commit/0e0f9a27d9233b2fdbd28d049306a24992b9f480))
* **retain-cursor:** bound v3 cursor, fix edit dedupe regression ([5035748](https://github.com/luxus/pi-hindsight/commit/5035748ec014210114c2f558d9a6da0f64f927d8))
* **retain-cursor:** clamp frontier when branch shrinks transcript ([99ec414](https://github.com/luxus/pi-hindsight/commit/99ec414ec6b6845ab1152a32b8e390437c37f4bd))
* **retain:** harden retain-cursor dedupe for long sessions ([2704dc0](https://github.com/luxus/pi-hindsight/commit/2704dc0e36d2ee4d7f1b1993d33a5446955408c1))

## [0.6.0](https://github.com/luxus/pi-hindsight/compare/v0.5.0...v0.6.0) (2026-05-20)


### Features

* **client:** add exponential-backoff retry to REST calls ([a9329cd](https://github.com/luxus/pi-hindsight/commit/a9329cd95073b7a0581e3d46bcea3a9e82f6ff35))
* **lifecycle:** add 60s TTL recall cache per session ([#387](https://github.com/luxus/pi-hindsight/issues/387)) ([b8dbdcb](https://github.com/luxus/pi-hindsight/commit/b8dbdcb19cfbcb821ee37383caf4806e83c2c6ef))
* **lifecycle:** add error reporting to periodic and shutdown queue flush ([#388](https://github.com/luxus/pi-hindsight/issues/388)) ([bd93c9e](https://github.com/luxus/pi-hindsight/commit/bd93c9e858076dc82ec3a68ebfddd37f6d9591ce))
* **retain:** add optional post-retain reflect ([#390](https://github.com/luxus/pi-hindsight/issues/390)) ([d0f4aed](https://github.com/luxus/pi-hindsight/commit/d0f4aed9beb911dde7bc565dc3c72f93597f29ae))


### Bug Fixes

* **client:** restrict retry to idempotent methods per review ([d501723](https://github.com/luxus/pi-hindsight/commit/d501723db33554b5e5948c90130e55dde88048c9))
* **deps:** align @vitest/coverage-v8 with vitest 4.1.5 and fix test breakages ([101ecdf](https://github.com/luxus/pi-hindsight/commit/101ecdf69f7faf5848ea3feee4ecb83b4faf6359))
* **flush-presenter:** warn on malformed queue entries ([#394](https://github.com/luxus/pi-hindsight/issues/394)) ([5797273](https://github.com/luxus/pi-hindsight/commit/5797273dae3ecbbe786cf6f83e74d58e0648d136))
* **lifecycle:** address review comments on flush notification behavior ([#389](https://github.com/luxus/pi-hindsight/issues/389)) ([5cf9833](https://github.com/luxus/pi-hindsight/commit/5cf9833d1a68e3923f4d4820382cacdd740a5ebb))
* **smoke:** always clean up temporary smoke-test banks, add opt-out env var ([fd49bd8](https://github.com/luxus/pi-hindsight/commit/fd49bd8e2b7f9203738871c8df414d08c178e20e)), closes [#382](https://github.com/luxus/pi-hindsight/issues/382)
* support Request-incompatible fetch wrappers ([#400](https://github.com/luxus/pi-hindsight/issues/400)) ([55e7f40](https://github.com/luxus/pi-hindsight/commit/55e7f40512aaad75964bc3ccdfc8a7ce1770d5d8))

## [0.5.0](https://github.com/luxus/pi-hindsight/compare/v0.4.1...v0.5.0) (2026-05-09)

### Features

- harden 1.0 readiness contract ([#360](https://github.com/luxus/pi-hindsight/issues/360)) ([e7a36c9](https://github.com/luxus/pi-hindsight/commit/e7a36c9c846e6d58676e2bf0626b3ac7c473a4a4))

### Bug Fixes

- **operation-catalog:** flatten recursive HindsightTagGroup tool schema ([#366](https://github.com/luxus/pi-hindsight/issues/366)) ([2b6518d](https://github.com/luxus/pi-hindsight/commit/2b6518d9bd2a44fbca2d31a67237bbb96c7414e4)), closes [#365](https://github.com/luxus/pi-hindsight/issues/365)
- **release:** publish through trusted workflow ([#350](https://github.com/luxus/pi-hindsight/issues/350)) ([fdd4eb0](https://github.com/luxus/pi-hindsight/commit/fdd4eb0844be9937c6847ac3cfb7ca7374431f1d))

## [0.4.1](https://github.com/luxus/pi-hindsight/compare/v0.4.0...v0.4.1) (2026-05-09)

### Bug Fixes

- **release:** harden audit surfaces ([#347](https://github.com/luxus/pi-hindsight/issues/347)) ([3f2d71c](https://github.com/luxus/pi-hindsight/commit/3f2d71cfdb955cafa2d8155b77b8bd7fb82057f2))

## [0.4.0](https://github.com/luxus/pi-hindsight/compare/v0.3.0...v0.4.0) (2026-05-09)

### Features

- **client:** adopt Hindsight client 0.6.1 ([caa4a48](https://github.com/luxus/pi-hindsight/commit/caa4a48b92129c394eb72fa8c0044d851464407e))
- **import:** show progress for transcript imports ([098c469](https://github.com/luxus/pi-hindsight/commit/098c469cc2113e553f070d584d14d02e2a18fa78))
- **tools:** add bank template import surface ([f30ca02](https://github.com/luxus/pi-hindsight/commit/f30ca0224ea080d4c294f65d8a0883332d0a0adf))
- **tools:** expose remaining memory surfaces ([3c071ac](https://github.com/luxus/pi-hindsight/commit/3c071ac9ce8c93c21e358f72690a3cc4ba51e006))

## [0.3.0](https://github.com/luxus/pi-hindsight/compare/v0.2.0...v0.3.0) (2026-05-07)

### Features

- **deps:** migrate Pi runtime package namespace ([ff89de7](https://github.com/luxus/pi-hindsight/commit/ff89de7e44f48ecf1a4e418e3fd13903fa3e3161))
- expose advanced recall controls ([be8c3c6](https://github.com/luxus/pi-hindsight/commit/be8c3c64904744aa68038d574af257272fc0a95a))
- **setup:** add guided memory profiles ([#321](https://github.com/luxus/pi-hindsight/issues/321)) ([f81d11d](https://github.com/luxus/pi-hindsight/commit/f81d11d0a2ffb42bc31d3b5dbe70838e3691be24))
- **tools:** add bank exploration tools ([98d0cd1](https://github.com/luxus/pi-hindsight/commit/98d0cd18c6537afd58f42527bfd29747420fa36d))
- **tools:** add Hindsight admin inspection tools ([1d27678](https://github.com/luxus/pi-hindsight/commit/1d276782fc2347b219946f4b435400ac09877bbe))

### Bug Fixes

- harden queue lock race retries on Windows ([b87c24b](https://github.com/luxus/pi-hindsight/commit/b87c24b2a43c7a65302959a013311a4b2f2726f9)), closes [#311](https://github.com/luxus/pi-hindsight/issues/311)
- **import:** dedupe queued gateway imports ([#301](https://github.com/luxus/pi-hindsight/issues/301)) ([8b11c88](https://github.com/luxus/pi-hindsight/commit/8b11c8897e62741afea607d32db38cbc1a351b74))
- **import:** skip empty curated session imports ([bcbf0b7](https://github.com/luxus/pi-hindsight/commit/bcbf0b7705b603bbdb35bc4e91e4df7562f20dd9))
- revalidate project import cwd during execution ([fde2e05](https://github.com/luxus/pi-hindsight/commit/fde2e05bf32db198daa8ca697ab7930fd2553bc0))
- **security:** redact setup error surfaces ([cd0122d](https://github.com/luxus/pi-hindsight/commit/cd0122db5405b0128e6160d5b480ffbce6f3bdbe)), closes [#298](https://github.com/luxus/pi-hindsight/issues/298)

## [0.2.0](https://github.com/luxus/pi-hindsight/compare/v0.1.0...v0.2.0) (2026-05-06)

### Features

- add import status activity labels ([3158aac](https://github.com/luxus/pi-hindsight/commit/3158aac4dd0a7790bdb360394afb9f3667df375a)), closes [#248](https://github.com/luxus/pi-hindsight/issues/248)
- add internal recall reflect option parity ([af769be](https://github.com/luxus/pi-hindsight/commit/af769beaecbf88db1211e0f272cc7fef51519862)), closes [#248](https://github.com/luxus/pi-hindsight/issues/248)
- add internal retain option parity ([d2b62bb](https://github.com/luxus/pi-hindsight/commit/d2b62bb25cb58bef8ea5d2da81f60b16160e6271)), closes [#248](https://github.com/luxus/pi-hindsight/issues/248)
- **bank-settings:** add config reset tools ([1c1c662](https://github.com/luxus/pi-hindsight/commit/1c1c662a052562e2dd7150f4c883ba42b6a4dae1))
- **bank-settings:** add directive tools ([12a188b](https://github.com/luxus/pi-hindsight/commit/12a188b5a9f0193fd93386394494c0162805baf0))
- **bank-settings:** add location presenter ([b6d0b00](https://github.com/luxus/pi-hindsight/commit/b6d0b006fcd5129d7ce7d02f0b3f882f7fb2da50))
- **bank-templates:** add schema fetch tool ([f89ffba](https://github.com/luxus/pi-hindsight/commit/f89ffbaa265a1d9af89b214e10d1a87ba74a9760))
- **bank-templates:** save exported manifests ([505a2de](https://github.com/luxus/pi-hindsight/commit/505a2de34962f4a8154f6fd28182e2ac6ce134f1))
- **config:** migrate global memory config to user ([e7b3a8d](https://github.com/luxus/pi-hindsight/commit/e7b3a8dd05a0f6dfd74d164ae99b5ae39b8218e8))
- **config:** read bank missions from Hindsight config ([ed15207](https://github.com/luxus/pi-hindsight/commit/ed15207cfa56e0a310cf6345b258d1965501f801))
- configure import tool result policy ([115b4dc](https://github.com/luxus/pi-hindsight/commit/115b4dc1ad0f145f38c78a874fbd27527d837079)), closes [#248](https://github.com/luxus/pi-hindsight/issues/248)
- **core:** expose mental model api seam ([e6009d2](https://github.com/luxus/pi-hindsight/commit/e6009d2864dd01d8d3a957adacbf12f1b52c75c1))
- **diagnostics:** show latest import quality ([6607a4d](https://github.com/luxus/pi-hindsight/commit/6607a4d02ce1abc157fbe4a35ceb7be0812f028d)), closes [#275](https://github.com/luxus/pi-hindsight/issues/275)
- filter low-quality recall results ([5cebb3b](https://github.com/luxus/pi-hindsight/commit/5cebb3bf843898ca937458cd515cc483a7eca1d1)), closes [#248](https://github.com/luxus/pi-hindsight/issues/248)
- **import:** add gateway transcript import ([4498efd](https://github.com/luxus/pi-hindsight/commit/4498efdc3274fac6ac970df058cb8762fbdfb8b2))
- **import:** add historical import modes ([6d45d6d](https://github.com/luxus/pi-hindsight/commit/6d45d6d34ec4d94c6ff199fddc619d1d32c36774))
- **import:** add strict curated quality profile ([81b70b5](https://github.com/luxus/pi-hindsight/commit/81b70b5624f80f44639c65db53c393f8da08e388)), closes [#248](https://github.com/luxus/pi-hindsight/issues/248)
- **import:** chunk curated sessions by turns ([4cad43d](https://github.com/luxus/pi-hindsight/commit/4cad43df5a776441327799679acac87c683b96dd))
- **import:** offer post-import mental model refresh ([1bea940](https://github.com/luxus/pi-hindsight/commit/1bea94004fb5a91eb9a7398b3e7a8a3d7cb96131))
- **import:** record checkpoint quality context ([efc82b7](https://github.com/luxus/pi-hindsight/commit/efc82b747c4f90d5b081e37bf393accae30304b4))
- **import:** summarize import signal and noise ([5acb3f9](https://github.com/luxus/pi-hindsight/commit/5acb3f9f83c9f2114bc775afb81cdd8bde180727)), closes [#273](https://github.com/luxus/pi-hindsight/issues/273)
- **import:** summarize project import quality ([ced79b2](https://github.com/luxus/pi-hindsight/commit/ced79b221d1e18bdb186b9a24b517ca8a2ef4ac7)), closes [#269](https://github.com/luxus/pi-hindsight/issues/269)
- **operations:** promote reflect query to mental model ([780c6e1](https://github.com/luxus/pi-hindsight/commit/780c6e1dd88700728f4c3a2d79d218a5ade73373))
- **retain:** expose explicit retain options ([bfb768b](https://github.com/luxus/pi-hindsight/commit/bfb768b8bde6805e10e5027096880cd75e9e1320))
- **routing:** explain route dry runs ([a744e8d](https://github.com/luxus/pi-hindsight/commit/a744e8d72cb0812fc4d1a2ed5cd3685b95200af3))
- **setup:** add built-in bank templates and import metrics ([c25a6b2](https://github.com/luxus/pi-hindsight/commit/c25a6b25f3e6db35e7c49b1e0036db428920c161))
- **setup:** offer profile-aware historical import ([7dcefed](https://github.com/luxus/pi-hindsight/commit/7dcefed35321f5579c0f69bec4deb826b89cb700))
- **setup:** review bank templates before apply ([03388ae](https://github.com/luxus/pi-hindsight/commit/03388ae03588decab2567f18d9d0b213250dfb0c))
- show import quality reason counts ([1f59cdd](https://github.com/luxus/pi-hindsight/commit/1f59cdd0e4e7396a45f0b77f1c46801e9b8b02df)), closes [#248](https://github.com/luxus/pi-hindsight/issues/248)
- support Hindsight 0.6 ([2187444](https://github.com/luxus/pi-hindsight/commit/21874443be69836a66ca8ab7d262b8ccf2162e95)), closes [#234](https://github.com/luxus/pi-hindsight/issues/234)
- **template:** add setup template editor model ([a401f7c](https://github.com/luxus/pi-hindsight/commit/a401f7c34bf17c113eb5a9255d99dfd65a123104))
- **template:** export bank manifests ([3bf800a](https://github.com/luxus/pi-hindsight/commit/3bf800a25a155ce46b865c61dbab2638c0994b3f))
- **tui:** add guided memory setup ([15df71f](https://github.com/luxus/pi-hindsight/commit/15df71f6cbbcb5e4d85eca02c29b0bbf8d1eb961))
- **tui:** add mental model library ([00e8527](https://github.com/luxus/pi-hindsight/commit/00e85276da56a6071a8cb5ef3f1617d41943656e))
- **tui:** add setup flow state machine ([245fea8](https://github.com/luxus/pi-hindsight/commit/245fea8a52d427718f6bb05ef314d79c713b0e48))
- **tui:** flush retain queue from setup ([71aff41](https://github.com/luxus/pi-hindsight/commit/71aff416f3d236b049de31286859a5b356be3655))
- **tui:** import bank templates during setup ([9eaaefb](https://github.com/luxus/pi-hindsight/commit/9eaaefb9cff9346645225a760d81ab686045b018))
- **tui:** make mental models read-only ([06dd166](https://github.com/luxus/pi-hindsight/commit/06dd166314120327c9f22cd02684835f8cbbab5f))

### Bug Fixes

- enable docs pages workflow ([5487783](https://github.com/luxus/pi-hindsight/commit/5487783cc057feecd3f861f74ca2c8951245736f))
- **import:** harden provenance and resume idempotency ([3eab1ce](https://github.com/luxus/pi-hindsight/commit/3eab1ce0028f741b6ff812da80144a8e1d547244))
- **release:** align release-please tags ([ebf45b3](https://github.com/luxus/pi-hindsight/commit/ebf45b3a7cd89e2e29b0006d010f89f760e7c76b))
- resolve release blockers ([3412ae7](https://github.com/luxus/pi-hindsight/commit/3412ae75944cc5b46338dfc8d4ab85e06c585060))
- **retain:** redact retained context ([06460be](https://github.com/luxus/pi-hindsight/commit/06460be6b3b792946d765cdcb259245ef7515f97)), closes [#279](https://github.com/luxus/pi-hindsight/issues/279)

## 0.1.0 (2026-04-29)

### Features

- expose release readiness memory controls ([5b1ebcb](https://github.com/luxus/pi-hindsight/commit/5b1ebcb9c364d431c2140c0eea268f4d170f7d66))
- add recall cleanup command ([ed993d0](https://github.com/luxus/pi-hindsight/commit/ed993d0f87ba44b4fab15f414e40f208e44c8469))
- add api key secret refs ([8ef4ec5](https://github.com/luxus/pi-hindsight/commit/8ef4ec5dc58f8bb3c6047011b1abbc1ea99678a7))
- add setup deployment guidance ([d3c1dcd](https://github.com/luxus/pi-hindsight/commit/d3c1dcdef8a01db5bfe6aa23e4f581efdf70ba4b))
- add project session imports ([bd343b9](https://github.com/luxus/pi-hindsight/commit/bd343b99a653ea1f36991941a3ba1add226954b1))
- add import checkpoint resume ([95da3dd](https://github.com/luxus/pi-hindsight/commit/95da3dd00ec92dc08995636a8d28a028b7bcb2a1))
- add import dry-run previews ([008788d](https://github.com/luxus/pi-hindsight/commit/008788dc0cb505fd0be2fecaa9277267bf7db2c0))
- add bank-aware recall queries ([f1c091c](https://github.com/luxus/pi-hindsight/commit/f1c091cbd49710da27310c0d07a43995cb4987f9))
- add opt-in recall visibility ([5957070](https://github.com/luxus/pi-hindsight/commit/5957070bf0e3e37980e5d12bc9b0fb7104b66839))
- improve recall query construction ([9109da6](https://github.com/luxus/pi-hindsight/commit/9109da6f21ad413025afda8f7eb3a8d5002b7196))
- pass retain observation scopes ([30c20fa](https://github.com/luxus/pi-hindsight/commit/30c20fa34503c4aea33c92df9424d1869907ba88))
- add global memory profiles ([4983fc8](https://github.com/luxus/pi-hindsight/commit/4983fc8e47a2f9982ed1099358d5fa27d05e5b90))
- add session memory governance ([1d47ea8](https://github.com/luxus/pi-hindsight/commit/1d47ea83bd37e240218cec732ab4037eaecd80f6))
- add rich retain projection policy ([5b39e1a](https://github.com/luxus/pi-hindsight/commit/5b39e1a84a1cc8966f6e3d0cd16cdf35c03fb56b))
- add observation scope config ([0ffc7d2](https://github.com/luxus/pi-hindsight/commit/0ffc7d2bd34576898250b27b9fa7f77286df04d2))
- support bank missions ([de41cba](https://github.com/luxus/pi-hindsight/commit/de41cba3e76408b12849526e73d928a04e958d4d))
- add recall query controls ([b6155c6](https://github.com/luxus/pi-hindsight/commit/b6155c6d34ea759a91fc96efdb9e0969f596a127))
- detect append retain capability ([2f1cdcb](https://github.com/luxus/pi-hindsight/commit/2f1cdcbfa58479b2985f3d81159bb502e32abc77))
- improve Hindsight status visibility ([deeab18](https://github.com/luxus/pi-hindsight/commit/deeab189dd77ca553a6b6159c71e6d64b6b4b3ec))
- implement Pi Hindsight MVP ([ec7e749](https://github.com/luxus/pi-hindsight/commit/ec7e749d34a9548b38c34226aa886faac7a9090a))

### Bug Fixes

- block active recall cleanup prune ([676d548](https://github.com/luxus/pi-hindsight/commit/676d548d3b26e8c9716803acac9b2620115697cb))
- improve doctor diagnostics ([6dd4e53](https://github.com/luxus/pi-hindsight/commit/6dd4e5334a6508119f24cba302c1e12b913898a3))
- validate api key ref strings ([f564784](https://github.com/luxus/pi-hindsight/commit/f5647842a4760ddda521c9b4b50b9a9f585c432e))
- isolate project import checkpoints ([e142bef](https://github.com/luxus/pi-hindsight/commit/e142befde4fc4c1dd4b57106d40dce5144bbd0f2))
- include import mode in checkpoint runs ([4e7c5ff](https://github.com/luxus/pi-hindsight/commit/4e7c5ff1ca5c0c359ff9ac712b889454593e691b))
- pass observation scopes for durable retain ([2ae0deb](https://github.com/luxus/pi-hindsight/commit/2ae0deb801a0a094536cb5b450d0d08d0d467f2a))
- harden recall failure handling ([212facf](https://github.com/luxus/pi-hindsight/commit/212facf8c04a2888d101aca4271fa7808672c8cc))
- harden append fallback replay ([ae9abcb](https://github.com/luxus/pi-hindsight/commit/ae9abcb5e330f21c8c8d80918aabdf793d529c28))
- keep enqueue tolerant of malformed queues ([7737741](https://github.com/luxus/pi-hindsight/commit/773774104a762e95035563d85e4a4b5a7fcf6d12))
- harden retain queue durability ([1d8ad9a](https://github.com/luxus/pi-hindsight/commit/1d8ad9a08e3295586189c01ba01e4e6039a0ff6c))
- preserve recall query overrides ([dc6cb4e](https://github.com/luxus/pi-hindsight/commit/dc6cb4eb01231915f7298d052e857166da5d9e83))
- skip empty recall query turns ([c38d23c](https://github.com/luxus/pi-hindsight/commit/c38d23c7a93bba89090a4e046790af572a02eeea))
- preserve global-only profile settings ([d1d91b2](https://github.com/luxus/pi-hindsight/commit/d1d91b2d7e5f524d10c64d54eb5da1c1fbda3202))
- preserve session retain opt-out ([0528690](https://github.com/luxus/pi-hindsight/commit/0528690559b1f756b5586d2da1a7acf2876e84b1))
- harden session governance recovery ([b57e30b](https://github.com/luxus/pi-hindsight/commit/b57e30b4cc4562774d284cf23e8f9dc4b72868d8))
- avoid recall after non-user turns ([e29e702](https://github.com/luxus/pi-hindsight/commit/e29e7026fdbfc0470f990f4a0b243988c7c3ce01))
- default recall for prompt caching ([3be7a9e](https://github.com/luxus/pi-hindsight/commit/3be7a9e1ba314c3bb74fcca589dd629089ac5990))
- default invalid tool filters ([df5cc03](https://github.com/luxus/pi-hindsight/commit/df5cc0345dd69f07113d4e7d63e5dde83faa9470))
- enable observations by default ([d625004](https://github.com/luxus/pi-hindsight/commit/d6250047a328c0d0870505d13d93b97f539b8967))
- isolate bank startup failures ([2502709](https://github.com/luxus/pi-hindsight/commit/25027090eb6a037c3b362f33e4cd148cd11d2c4f))
- keep appended recall as system context ([c635639](https://github.com/luxus/pi-hindsight/commit/c6356391546cb5ff90ef11a3a3149bf6cfa7e2bd))
- await append capability probe ([925e35d](https://github.com/luxus/pi-hindsight/commit/925e35d108f187e26812715c9b7388336998f6d2))
- keep active queue locks fresh ([a14cbc7](https://github.com/luxus/pi-hindsight/commit/a14cbc7428838caf7b1eddc597fafcf2124f8cf2))
- harden retain queue locking ([672da72](https://github.com/luxus/pi-hindsight/commit/672da72ad64146f2d1e72bb8c5e357e37d5d0953))
- queue explicit retain writes ([505160a](https://github.com/luxus/pi-hindsight/commit/505160ab94e45cf2d9be758088368ad8751a9989))
- ignore empty smoke test env values ([ae32865](https://github.com/luxus/pi-hindsight/commit/ae32865372a6d585d91c24b3eb6dddc34cfa3abe))

### Refactoring

- remove unreleased legacy shims ([feea9d2](https://github.com/luxus/pi-hindsight/commit/feea9d2b6df265e4080cb35d39c86d84ee7f1036))
- use retainBatch transport ([a0c7f67](https://github.com/luxus/pi-hindsight/commit/a0c7f67a62a9f302c86f9b570ecc2d122e21b97e))
- close memory hardening gaps ([6069534](https://github.com/luxus/pi-hindsight/commit/6069534742cb7b249ffd72161e4b1dc13d406381))
- harden memory durability seams ([e520d3a](https://github.com/luxus/pi-hindsight/commit/e520d3a7e42d68c0f47709d1f39b5218fe0a14e0))
- deepen memory operations ([702ac6e](https://github.com/luxus/pi-hindsight/commit/702ac6eca22ff364cce7c1e3cc99432a39f91db2))

### Documentation

- refresh changelog generation ([cd9593a](https://github.com/luxus/pi-hindsight/commit/cd9593afb698c4bf98511f4dd8718ac2d2b07dd7))
- mark global review loop complete ([e4a9318](https://github.com/luxus/pi-hindsight/commit/e4a9318b4a3c7c5deac7787468c563d2e4313912))
- record upstream retain issue ([c3de5aa](https://github.com/luxus/pi-hindsight/commit/c3de5aaa07c82ff7ef16f6f7c26ac221aadefa31))
- clarify release verification ([4f2de2c](https://github.com/luxus/pi-hindsight/commit/4f2de2c3821a59e17fa3600ab79f02fc4f991e63))
- refresh roadmap status ([14986ac](https://github.com/luxus/pi-hindsight/commit/14986ac14bda9ec2d42eb5b92db13a81dff30c44))
- clarify memory profile routing ([0698d03](https://github.com/luxus/pi-hindsight/commit/0698d03d11b1c5d0323b0f8c7a8512028ca70730))
- add follow-up maintainer feedback ([0a6bc96](https://github.com/luxus/pi-hindsight/commit/0a6bc965683784377c30d508cf3017a9632033e0))
- add maintainer feedback to roadmap ([3deb058](https://github.com/luxus/pi-hindsight/commit/3deb058ecfa8d1f49e217de8102300ee25f2a526))
- add next changes plan ([f2c1b70](https://github.com/luxus/pi-hindsight/commit/f2c1b70223d2a556cd966944d220f853d90b3040))
- update changelog ([c728926](https://github.com/luxus/pi-hindsight/commit/c72892649ba9b6116ef3f716b8bd0f10d001ffbc))
- update changelog ([1fb69fb](https://github.com/luxus/pi-hindsight/commit/1fb69fb08c4f50318389a9a20eaf7c641e093385))
- update changelog ([156a603](https://github.com/luxus/pi-hindsight/commit/156a603c54c61fb89a0d533a7702f7a32cde27ff))
- update changelog ([1acb50d](https://github.com/luxus/pi-hindsight/commit/1acb50df6a9739221d9fb86b444c3dad92bcacdb))
- update changelog ([5c35c36](https://github.com/luxus/pi-hindsight/commit/5c35c36cbec4fea1b4139c371db52a5cbf80d384))
- generate changelog ([433e90c](https://github.com/luxus/pi-hindsight/commit/433e90ce1dfa757c0cf24a7e988f43ee892ea468))

### Tests

- cover changelog generator ([48769c4](https://github.com/luxus/pi-hindsight/commit/48769c4457c6ab74c4a75952f112cb6f0a4b84af))

### CI

- update workflow actions to v6 ([0803e43](https://github.com/luxus/pi-hindsight/commit/0803e4334966aa477b928e5bdd5ad583d62d474a))
- add configured Hindsight smoke workflow ([2d3d837](https://github.com/luxus/pi-hindsight/commit/2d3d837aa00443e2bc95b398f408c16e03678b18))

### Chores

- remove unused changelog dependency ([ad3cd3a](https://github.com/luxus/pi-hindsight/commit/ad3cd3a6a5618b9588e159055582542a5bdffddf))
- prepare package release metadata ([7b7deea](https://github.com/luxus/pi-hindsight/commit/7b7deea8075502940e2523426042bafce0de98cc))
- ignore local agent skill files ([fd4d30e](https://github.com/luxus/pi-hindsight/commit/fd4d30eeaea7224cd8ce3c9e2213c7d7b9502833))

### Other Changes

- Cover next opt-out mode precedence ([a3b74ea](https://github.com/luxus/pi-hindsight/commit/a3b74ea18c0078bcd3fb61231e9bf334ec13f508))
- Keep next opt-out pending on cursor failure ([4e350a7](https://github.com/luxus/pi-hindsight/commit/4e350a7f04dc86e75606be3b06aa5a470b039d93))
- Expand next opt-out regression coverage ([331c43f](https://github.com/luxus/pi-hindsight/commit/331c43f07a77dba7970b5c535b69d075d6ab3225))
- Record next opt-out implementation ([ae2fd0a](https://github.com/luxus/pi-hindsight/commit/ae2fd0adf0cca1884cc6a83a1e5da966b9da112e))
- Add one-turn retain opt-out ([4439ca9](https://github.com/luxus/pi-hindsight/commit/4439ca9ce5e9c5763402621ca8370671d0465937))
- Health-check active diagnostics bank ([463d0fe](https://github.com/luxus/pi-hindsight/commit/463d0febc414190d3db8d0173610ad6ef4562a50))
- Filter recall artifacts from imports ([d3cefa0](https://github.com/luxus/pi-hindsight/commit/d3cefa0275a97b008aa8ebbaa8a14e9803107f7a))
- Tolerate malformed import lines ([906ffed](https://github.com/luxus/pi-hindsight/commit/906ffed1edd605baad2ec608010999f350df6b50))
- Add parent session import provenance ([eee9817](https://github.com/luxus/pi-hindsight/commit/eee98178665deae70e5effd61dd735061b693b16))
- Add Hindsight command argument completions ([529591e](https://github.com/luxus/pi-hindsight/commit/529591e3dd8c18d3350bd17837af9a9547f898f9))
- Dedupe dead-letter queue entries ([161959e](https://github.com/luxus/pi-hindsight/commit/161959e1f953f2f0155f4d7a6ac23172d2262471))
- Isolate append capability probe memory ([398b5f0](https://github.com/luxus/pi-hindsight/commit/398b5f03b54d75d68dc8ca7c3eb2287e1c8842f6))
- Tolerate corrupt import sidecars ([83f0658](https://github.com/luxus/pi-hindsight/commit/83f06580e42b970406e06575ea7b9255648b8675))
- Clarify no-bank diagnostics ([3f4a5cb](https://github.com/luxus/pi-hindsight/commit/3f4a5cbb1b39fa5eb7cb025232371c8cfde7aa52))
- Reject cross-project session imports ([a7614bd](https://github.com/luxus/pi-hindsight/commit/a7614bd2bb38c2d1b034ee8735b44e0e3d52952a))
- Isolate ephemeral session identity ([014e996](https://github.com/luxus/pi-hindsight/commit/014e9962091a6849917f104d6b03be4c8b5db163))
- Preserve rich retain payloads ([af27195](https://github.com/luxus/pi-hindsight/commit/af2719524308d9071b2f0776624edf26e27b939b))
- Redact secrets from memory errors ([fa48b56](https://github.com/luxus/pi-hindsight/commit/fa48b5675a0852e8e4c36ea769af7b94a1f7d20d))
- Tolerate malformed retain queue lines ([7785b9f](https://github.com/luxus/pi-hindsight/commit/7785b9f7fe6334c694a7ebad3d89e66b5aa6eb1e))
- Design one-turn memory opt-out ([6c41bd2](https://github.com/luxus/pi-hindsight/commit/6c41bd2809d28f6cdc2cb7acabf1bfc895574e07))
- Improve last recall inspection ([9932c60](https://github.com/luxus/pi-hindsight/commit/9932c60b7e8bdb6941cabc0f61030e3002cb5f1e))
- Document risky memory modes ([a2cca82](https://github.com/luxus/pi-hindsight/commit/a2cca8210ada48051e250154a03b15c5bdf82f22))
- Remove obsolete compatibility wording ([26137b4](https://github.com/luxus/pi-hindsight/commit/26137b4fb0021dafbe42cf19f5917321487ea820))
- Remove append fallback path ([fa7a02f](https://github.com/luxus/pi-hindsight/commit/fa7a02fe1711e37d9ea050e797306f9866b58cbf))
- Add post-MVP roadmap ([67c429f](https://github.com/luxus/pi-hindsight/commit/67c429f8779596653fd0abd82d01edff9486786c))
- Harden Hindsight MVP docs and memory invariants ([aaf6d55](https://github.com/luxus/pi-hindsight/commit/aaf6d55a010abfdb2bdcaf8067a8c008ec14645a))
