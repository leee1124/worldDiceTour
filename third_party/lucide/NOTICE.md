# 서드파티 아이콘: Lucide

- 출처: [lucide-static](https://www.npmjs.com/package/lucide-static) v1.47.0 (npm 레지스트리 배포본,
  `https://registry.npmjs.org/lucide-static/-/lucide-static-1.47.0.tgz`, sha1 `ad0520340308bc22b719e88f037a014866e5fe1f`)
- 라이선스: ISC (전문은 같은 폴더의 [`LICENSE`](./LICENSE) 참고). 그 중 Feather 프로젝트에서
  가져온 일부 아이콘(이 저장소가 쓰는 것 중 `lock`, `moon`, `search`, `target`, `circle-help`(Feather·구버전 lucide에서는 `help-circle`) 포함)은
  LICENSE 파일에 함께 실린 MIT 조항이 적용된다. 두 라이선스 모두 출처 표시 외 실질적인 사용 제약이 없다.
- 이 폴더(`public/vendor/lucide/svg/*.svg`)에는 실제로 쓰는 아이콘 21개의 **원본 SVG만** 받아 두었다
  (전체 세트를 담지 않는다). 각 파일 상단의 라이선스 주석은 원본 그대로 보존했다.
- 이 원본 SVG는 `scripts/buildIcons.js`가 읽어 `public/js/views/iconPaths.js`(생성 파일, 손으로
  고치지 말 것)를 만드는 데만 쓰인다. CSP가 `innerHTML`을 막기 때문에 마크업이 아니라
  "viewBox + 자식 서술자" 데이터로 내보내고, `public/js/views/icons.js`가 `dom.js`의 `svg()` 헬퍼로
  조립한다.
- 재생성: `node scripts/buildIcons.js`
- 아이콘 추가/교체: 새 `.svg`를 이 폴더에 받고 `scripts/buildIcons.js`의 `ICON_NAMES`에 파일명(확장자
  제외)을 추가한 뒤 다시 생성한다. 다운로드·생성 모두 개발 시점에만 하며, 런타임에는 이 폴더도
  `iconPaths.js`도 네트워크에 접근하지 않는다(완전 오프라인 동작 유지).
