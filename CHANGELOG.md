# Changelog

## 0.1.0 (2026-04-28)

### Features

- add api key secret refs ([8ef4ec5](https://github.com/luxus/pi-hindsight/commit/8ef4ec5dc58f8bb3c6047011b1abbc1ea99678a7))
- add bank-aware recall queries ([f1c091c](https://github.com/luxus/pi-hindsight/commit/f1c091cbd49710da27310c0d07a43995cb4987f9))
- add global memory profiles ([4983fc8](https://github.com/luxus/pi-hindsight/commit/4983fc8e47a2f9982ed1099358d5fa27d05e5b90))
- add import checkpoint resume ([95da3dd](https://github.com/luxus/pi-hindsight/commit/95da3dd00ec92dc08995636a8d28a028b7bcb2a1))
- add import dry-run previews ([008788d](https://github.com/luxus/pi-hindsight/commit/008788dc0cb505fd0be2fecaa9277267bf7db2c0))
- add observation scope config ([0ffc7d2](https://github.com/luxus/pi-hindsight/commit/0ffc7d2bd34576898250b27b9fa7f77286df04d2))
- add opt-in recall visibility ([5957070](https://github.com/luxus/pi-hindsight/commit/5957070bf0e3e37980e5d12bc9b0fb7104b66839))
- add project session imports ([bd343b9](https://github.com/luxus/pi-hindsight/commit/bd343b99a653ea1f36991941a3ba1add226954b1))
- add recall cleanup command ([ed993d0](https://github.com/luxus/pi-hindsight/commit/ed993d0f87ba44b4fab15f414e40f208e44c8469))
- add recall query controls ([b6155c6](https://github.com/luxus/pi-hindsight/commit/b6155c6d34ea759a91fc96efdb9e0969f596a127))
- add rich retain projection policy ([5b39e1a](https://github.com/luxus/pi-hindsight/commit/5b39e1a84a1cc8966f6e3d0cd16cdf35c03fb56b))
- add session memory governance ([1d47ea8](https://github.com/luxus/pi-hindsight/commit/1d47ea83bd37e240218cec732ab4037eaecd80f6))
- add setup deployment guidance ([d3c1dcd](https://github.com/luxus/pi-hindsight/commit/d3c1dcdef8a01db5bfe6aa23e4f581efdf70ba4b))
- detect append retain capability ([2f1cdcb](https://github.com/luxus/pi-hindsight/commit/2f1cdcbfa58479b2985f3d81159bb502e32abc77))
- implement Pi Hindsight MVP ([ec7e749](https://github.com/luxus/pi-hindsight/commit/ec7e749d34a9548b38c34226aa886faac7a9090a))
- improve Hindsight status visibility ([deeab18](https://github.com/luxus/pi-hindsight/commit/deeab189dd77ca553a6b6159c71e6d64b6b4b3ec))
- improve recall query construction ([9109da6](https://github.com/luxus/pi-hindsight/commit/9109da6f21ad413025afda8f7eb3a8d5002b7196))
- pass retain observation scopes ([30c20fa](https://github.com/luxus/pi-hindsight/commit/30c20fa34503c4aea33c92df9424d1869907ba88))
- support bank missions ([de41cba](https://github.com/luxus/pi-hindsight/commit/de41cba3e76408b12849526e73d928a04e958d4d))
- tune memory quality defaults ([37fb16f](https://github.com/luxus/pi-hindsight/commit/37fb16f146ef375a51b5f76dc0fc7e0f7d3c36e9))

### Bug Fixes

- avoid recall after non-user turns ([e29e702](https://github.com/luxus/pi-hindsight/commit/e29e7026fdbfc0470f990f4a0b243988c7c3ce01))
- await append capability probe ([925e35d](https://github.com/luxus/pi-hindsight/commit/925e35d108f187e26812715c9b7388336998f6d2))
- block active recall cleanup prune ([676d548](https://github.com/luxus/pi-hindsight/commit/676d548d3b26e8c9716803acac9b2620115697cb))
- default invalid tool filters ([df5cc03](https://github.com/luxus/pi-hindsight/commit/df5cc0345dd69f07113d4e7d63e5dde83faa9470))
- default recall for prompt caching ([3be7a9e](https://github.com/luxus/pi-hindsight/commit/3be7a9e1ba314c3bb74fcca589dd629089ac5990))
- enable observations by default ([d625004](https://github.com/luxus/pi-hindsight/commit/d6250047a328c0d0870505d13d93b97f539b8967))
- harden append fallback replay ([ae9abcb](https://github.com/luxus/pi-hindsight/commit/ae9abcb5e330f21c8c8d80918aabdf793d529c28))
- harden recall failure handling ([212facf](https://github.com/luxus/pi-hindsight/commit/212facf8c04a2888d101aca4271fa7808672c8cc))
- harden retain queue durability ([1d8ad9a](https://github.com/luxus/pi-hindsight/commit/1d8ad9a08e3295586189c01ba01e4e6039a0ff6c))
- harden retain queue locking ([672da72](https://github.com/luxus/pi-hindsight/commit/672da72ad64146f2d1e72bb8c5e357e37d5d0953))
- harden session governance recovery ([b57e30b](https://github.com/luxus/pi-hindsight/commit/b57e30b4cc4562774d284cf23e8f9dc4b72868d8))
- ignore empty smoke test env values ([ae32865](https://github.com/luxus/pi-hindsight/commit/ae32865372a6d585d91c24b3eb6dddc34cfa3abe))
- improve doctor diagnostics ([6dd4e53](https://github.com/luxus/pi-hindsight/commit/6dd4e5334a6508119f24cba302c1e12b913898a3))
- include import mode in checkpoint runs ([4e7c5ff](https://github.com/luxus/pi-hindsight/commit/4e7c5ff1ca5c0c359ff9ac712b889454593e691b))
- isolate bank startup failures ([2502709](https://github.com/luxus/pi-hindsight/commit/25027090eb6a037c3b362f33e4cd148cd11d2c4f))
- isolate project import checkpoints ([e142bef](https://github.com/luxus/pi-hindsight/commit/e142befde4fc4c1dd4b57106d40dce5144bbd0f2))
- keep active queue locks fresh ([a14cbc7](https://github.com/luxus/pi-hindsight/commit/a14cbc7428838caf7b1eddc597fafcf2124f8cf2))
- keep appended recall as system context ([c635639](https://github.com/luxus/pi-hindsight/commit/c6356391546cb5ff90ef11a3a3149bf6cfa7e2bd))
- keep enqueue tolerant of malformed queues ([7737741](https://github.com/luxus/pi-hindsight/commit/773774104a762e95035563d85e4a4b5a7fcf6d12))
- pass observation scopes for durable retain ([2ae0deb](https://github.com/luxus/pi-hindsight/commit/2ae0deb801a0a094536cb5b450d0d08d0d467f2a))
- preserve global-only profile settings ([d1d91b2](https://github.com/luxus/pi-hindsight/commit/d1d91b2d7e5f524d10c64d54eb5da1c1fbda3202))
- preserve recall query overrides ([dc6cb4e](https://github.com/luxus/pi-hindsight/commit/dc6cb4eb01231915f7298d052e857166da5d9e83))
- preserve session retain opt-out ([0528690](https://github.com/luxus/pi-hindsight/commit/0528690559b1f756b5586d2da1a7acf2876e84b1))
- queue explicit retain writes ([505160a](https://github.com/luxus/pi-hindsight/commit/505160ab94e45cf2d9be758088368ad8751a9989))
- report retain queue diagnostics ([b4843fc](https://github.com/luxus/pi-hindsight/commit/b4843fccf72fe01cdb8b8c8a76b8ca3d415e2e47))
- skip empty recall query turns ([c38d23c](https://github.com/luxus/pi-hindsight/commit/c38d23c7a93bba89090a4e046790af572a02eeea))
- validate api key ref strings ([f564784](https://github.com/luxus/pi-hindsight/commit/f5647842a4760ddda521c9b4b50b9a9f585c432e))

### Refactoring

- close memory hardening gaps ([6069534](https://github.com/luxus/pi-hindsight/commit/6069534742cb7b249ffd72161e4b1dc13d406381))
- deepen memory operations ([702ac6e](https://github.com/luxus/pi-hindsight/commit/702ac6eca22ff364cce7c1e3cc99432a39f91db2))
- harden memory durability seams ([e520d3a](https://github.com/luxus/pi-hindsight/commit/e520d3a7e42d68c0f47709d1f39b5218fe0a14e0))
- remove unreleased legacy shims ([feea9d2](https://github.com/luxus/pi-hindsight/commit/feea9d2b6df265e4080cb35d39c86d84ee7f1036))
- use retainBatch transport ([a0c7f67](https://github.com/luxus/pi-hindsight/commit/a0c7f67a62a9f302c86f9b570ecc2d122e21b97e))

### Documentation

- add follow-up maintainer feedback ([0a6bc96](https://github.com/luxus/pi-hindsight/commit/0a6bc965683784377c30d508cf3017a9632033e0))
- add maintainer feedback to roadmap ([3deb058](https://github.com/luxus/pi-hindsight/commit/3deb058ecfa8d1f49e217de8102300ee25f2a526))
- add next changes plan ([f2c1b70](https://github.com/luxus/pi-hindsight/commit/f2c1b70223d2a556cd966944d220f853d90b3040))
- add PR roadmap ([bde4820](https://github.com/luxus/pi-hindsight/commit/bde4820dac2f3c41f3f0f0defdab1968961fff9b))
- clarify import previews ([04cf139](https://github.com/luxus/pi-hindsight/commit/04cf13957504eb21b5a9effbc8894b121f7d256e))
- clarify memory profile routing ([0698d03](https://github.com/luxus/pi-hindsight/commit/0698d03d11b1c5d0323b0f8c7a8512028ca70730))
- clarify release verification ([4f2de2c](https://github.com/luxus/pi-hindsight/commit/4f2de2c3821a59e17fa3600ab79f02fc4f991e63))
- generate changelog ([433e90c](https://github.com/luxus/pi-hindsight/commit/433e90ce1dfa757c0cf24a7e988f43ee892ea468))
- record upstream retain issue ([c3de5aa](https://github.com/luxus/pi-hindsight/commit/c3de5aaa07c82ff7ef16f6f7c26ac221aadefa31))
- refresh roadmap status ([14986ac](https://github.com/luxus/pi-hindsight/commit/14986ac14bda9ec2d42eb5b92db13a81dff30c44))
- simplify configuration path ([6f3bb1d](https://github.com/luxus/pi-hindsight/commit/6f3bb1d174a9fbf1b7f02052443825b36da68b6b))
- update changelog ([c728926](https://github.com/luxus/pi-hindsight/commit/c72892649ba9b6116ef3f716b8bd0f10d001ffbc))
- update changelog ([1fb69fb](https://github.com/luxus/pi-hindsight/commit/1fb69fb08c4f50318389a9a20eaf7c641e093385))
- update changelog ([156a603](https://github.com/luxus/pi-hindsight/commit/156a603c54c61fb89a0d533a7702f7a32cde27ff))
- update changelog ([1acb50d](https://github.com/luxus/pi-hindsight/commit/1acb50df6a9739221d9fb86b444c3dad92bcacdb))
- update changelog ([5c35c36](https://github.com/luxus/pi-hindsight/commit/5c35c36cbec4fea1b4139c371db52a5cbf80d384))

### Tests

- cover Hindsight memory invariants ([2c548c8](https://github.com/luxus/pi-hindsight/commit/2c548c8a731dad21a6e25165864a9d51beed7379))

### CI

- add configured Hindsight smoke workflow ([2d3d837](https://github.com/luxus/pi-hindsight/commit/2d3d837aa00443e2bc95b398f408c16e03678b18))
- update workflow actions to v6 ([0803e43](https://github.com/luxus/pi-hindsight/commit/0803e4334966aa477b928e5bdd5ad583d62d474a))

### Chores

- ignore local agent skill files ([fd4d30e](https://github.com/luxus/pi-hindsight/commit/fd4d30eeaea7224cd8ce3c9e2213c7d7b9502833))
- prepare package release metadata ([7b7deea](https://github.com/luxus/pi-hindsight/commit/7b7deea8075502940e2523426042bafce0de98cc))
