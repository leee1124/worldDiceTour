/**
 * Lucide 아이콘 벡터 데이터 — **자동 생성 파일. 손으로 고치지 말 것.**
 *
 * 생성 명령: `node scripts/buildIcons.js`
 * 원본: lucide-static v1.47.0 (ISC/MIT, public/vendor/lucide/LICENSE · NOTICE.md),
 *       public/vendor/lucide/svg/*.svg
 *
 * CSP가 innerHTML을 막으므로(public/js/dom.js) SVG 마크업 문자열이 아니라
 * "viewBox + 자식 엘리먼트 서술자" 데이터로 내보낸다. public/js/views/icons.js의
 * libraryIcon()이 dom.js의 svg() 헬퍼로 이 데이터를 조립해 currentColor · 선 굵기 2 아이콘을 그린다.
 */

/** 생성에 쓰인 lucide-static 버전(재생성 시 참고용). */
export const LUCIDE_VERSION = '1.47.0';

/** 아이콘 이름 → { viewBox, children: [{ tag, attrs }] }. */
export const LUCIDE_ICONS = Object.freeze({
  "flag": {
    "viewBox": "0 0 24 24",
    "children": [
      {
        "tag": "path",
        "attrs": {
          "d": "M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528"
        }
      }
    ]
  },
  "plane": {
    "viewBox": "0 0 24 24",
    "children": [
      {
        "tag": "path",
        "attrs": {
          "d": "M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"
        }
      }
    ]
  },
  "ticket": {
    "viewBox": "0 0 24 24",
    "children": [
      {
        "tag": "path",
        "attrs": {
          "d": "M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"
        }
      },
      {
        "tag": "path",
        "attrs": {
          "d": "M13 5v2"
        }
      },
      {
        "tag": "path",
        "attrs": {
          "d": "M13 17v2"
        }
      },
      {
        "tag": "path",
        "attrs": {
          "d": "M13 11v2"
        }
      }
    ]
  },
  "stamp": {
    "viewBox": "0 0 24 24",
    "children": [
      {
        "tag": "path",
        "attrs": {
          "d": "M14 13V8.5C14 7 15 7 15 5a3 3 0 0 0-6 0c0 2 1 2 1 3.5V13"
        }
      },
      {
        "tag": "path",
        "attrs": {
          "d": "M20 15.5a2.5 2.5 0 0 0-2.5-2.5h-11A2.5 2.5 0 0 0 4 15.5V17a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1z"
        }
      },
      {
        "tag": "path",
        "attrs": {
          "d": "M5 22h14"
        }
      }
    ]
  },
  "x": {
    "viewBox": "0 0 24 24",
    "children": [
      {
        "tag": "path",
        "attrs": {
          "d": "M18 6 6 18"
        }
      },
      {
        "tag": "path",
        "attrs": {
          "d": "m6 6 12 12"
        }
      }
    ]
  },
  "lock": {
    "viewBox": "0 0 24 24",
    "children": [
      {
        "tag": "rect",
        "attrs": {
          "width": 18,
          "height": 11,
          "x": 3,
          "y": 11,
          "rx": 2,
          "ry": 2
        }
      },
      {
        "tag": "path",
        "attrs": {
          "d": "M7 11V7a5 5 0 0 1 10 0v4"
        }
      }
    ]
  },
  "map-pin": {
    "viewBox": "0 0 24 24",
    "children": [
      {
        "tag": "path",
        "attrs": {
          "d": "M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"
        }
      },
      {
        "tag": "circle",
        "attrs": {
          "cx": 12,
          "cy": 10,
          "r": 3
        }
      }
    ]
  },
  "sun": {
    "viewBox": "0 0 24 24",
    "children": [
      {
        "tag": "circle",
        "attrs": {
          "cx": 12,
          "cy": 12,
          "r": 4
        }
      },
      {
        "tag": "path",
        "attrs": {
          "d": "M12 2v2"
        }
      },
      {
        "tag": "path",
        "attrs": {
          "d": "M12 20v2"
        }
      },
      {
        "tag": "path",
        "attrs": {
          "d": "m4.93 4.93 1.41 1.41"
        }
      },
      {
        "tag": "path",
        "attrs": {
          "d": "m17.66 17.66 1.41 1.41"
        }
      },
      {
        "tag": "path",
        "attrs": {
          "d": "M2 12h2"
        }
      },
      {
        "tag": "path",
        "attrs": {
          "d": "M20 12h2"
        }
      },
      {
        "tag": "path",
        "attrs": {
          "d": "m6.34 17.66-1.41 1.41"
        }
      },
      {
        "tag": "path",
        "attrs": {
          "d": "m19.07 4.93-1.41 1.41"
        }
      }
    ]
  },
  "moon": {
    "viewBox": "0 0 24 24",
    "children": [
      {
        "tag": "path",
        "attrs": {
          "d": "M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"
        }
      }
    ]
  },
  "sun-moon": {
    "viewBox": "0 0 24 24",
    "children": [
      {
        "tag": "path",
        "attrs": {
          "d": "M12 2v2"
        }
      },
      {
        "tag": "path",
        "attrs": {
          "d": "M14.837 16.385a6 6 0 1 1-7.223-7.222c.624-.147.97.66.715 1.248a4 4 0 0 0 5.26 5.259c.589-.255 1.396.09 1.248.715"
        }
      },
      {
        "tag": "path",
        "attrs": {
          "d": "M16 12a4 4 0 0 0-4-4"
        }
      },
      {
        "tag": "path",
        "attrs": {
          "d": "m19 5-1.256 1.256"
        }
      },
      {
        "tag": "path",
        "attrs": {
          "d": "M20 12h2"
        }
      }
    ]
  },
  "search": {
    "viewBox": "0 0 24 24",
    "children": [
      {
        "tag": "path",
        "attrs": {
          "d": "m21 21-4.34-4.34"
        }
      },
      {
        "tag": "circle",
        "attrs": {
          "cx": 11,
          "cy": 11,
          "r": 8
        }
      }
    ]
  },
  "target": {
    "viewBox": "0 0 24 24",
    "children": [
      {
        "tag": "circle",
        "attrs": {
          "cx": 12,
          "cy": 12,
          "r": 10
        }
      },
      {
        "tag": "circle",
        "attrs": {
          "cx": 12,
          "cy": 12,
          "r": 6
        }
      },
      {
        "tag": "circle",
        "attrs": {
          "cx": 12,
          "cy": 12,
          "r": 2
        }
      }
    ]
  },
  "circle-help": {
    "viewBox": "0 0 24 24",
    "children": [
      {
        "tag": "circle",
        "attrs": {
          "cx": 12,
          "cy": 12,
          "r": 10
        }
      },
      {
        "tag": "path",
        "attrs": {
          "d": "M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"
        }
      },
      {
        "tag": "path",
        "attrs": {
          "d": "M12 17h.01"
        }
      }
    ]
  },
  "trending-up": {
    "viewBox": "0 0 24 24",
    "children": [
      {
        "tag": "path",
        "attrs": {
          "d": "M16 7h6v6"
        }
      },
      {
        "tag": "path",
        "attrs": {
          "d": "m22 7-8.5 8.5-5-5L2 17"
        }
      }
    ]
  },
  "landmark": {
    "viewBox": "0 0 24 24",
    "children": [
      {
        "tag": "path",
        "attrs": {
          "d": "M10 18v-7"
        }
      },
      {
        "tag": "path",
        "attrs": {
          "d": "M11.119 2.205a2 2 0 0 1 1.762 0l7.84 3.846A.5.5 0 0 1 20.5 7h-17a.5.5 0 0 1-.22-.949z"
        }
      },
      {
        "tag": "path",
        "attrs": {
          "d": "M14 18v-7"
        }
      },
      {
        "tag": "path",
        "attrs": {
          "d": "M18 18v-7"
        }
      },
      {
        "tag": "path",
        "attrs": {
          "d": "M3 22h18"
        }
      },
      {
        "tag": "path",
        "attrs": {
          "d": "M6 18v-7"
        }
      }
    ]
  },
  "newspaper": {
    "viewBox": "0 0 24 24",
    "children": [
      {
        "tag": "path",
        "attrs": {
          "d": "M15 18h-5"
        }
      },
      {
        "tag": "path",
        "attrs": {
          "d": "M18 14h-8"
        }
      },
      {
        "tag": "path",
        "attrs": {
          "d": "M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-4 0v-9a2 2 0 0 1 2-2h2"
        }
      },
      {
        "tag": "rect",
        "attrs": {
          "width": 8,
          "height": 4,
          "x": 10,
          "y": 6,
          "rx": 1
        }
      }
    ]
  },
  "receipt": {
    "viewBox": "0 0 24 24",
    "children": [
      {
        "tag": "path",
        "attrs": {
          "d": "M12 17V7"
        }
      },
      {
        "tag": "path",
        "attrs": {
          "d": "M16 8h-6a2 2 0 0 0 0 4h4a2 2 0 0 1 0 4H8"
        }
      },
      {
        "tag": "path",
        "attrs": {
          "d": "M4 3a1 1 0 0 1 1-1 1.3 1.3 0 0 1 .7.2l.933.6a1.3 1.3 0 0 0 1.4 0l.934-.6a1.3 1.3 0 0 1 1.4 0l.933.6a1.3 1.3 0 0 0 1.4 0l.933-.6a1.3 1.3 0 0 1 1.4 0l.934.6a1.3 1.3 0 0 0 1.4 0l.933-.6A1.3 1.3 0 0 1 19 2a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1 1.3 1.3 0 0 1-.7-.2l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.934.6a1.3 1.3 0 0 1-1.4 0l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-1.4 0l-.934-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-.7.2 1 1 0 0 1-1-1z"
        }
      }
    ]
  },
  "arrow-left-right": {
    "viewBox": "0 0 24 24",
    "children": [
      {
        "tag": "path",
        "attrs": {
          "d": "M8 3 4 7l4 4"
        }
      },
      {
        "tag": "path",
        "attrs": {
          "d": "M4 7h16"
        }
      },
      {
        "tag": "path",
        "attrs": {
          "d": "m16 21 4-4-4-4"
        }
      },
      {
        "tag": "path",
        "attrs": {
          "d": "M20 17H4"
        }
      }
    ]
  },
  "flame": {
    "viewBox": "0 0 24 24",
    "children": [
      {
        "tag": "path",
        "attrs": {
          "d": "M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4"
        }
      }
    ]
  },
  "cloud-rain": {
    "viewBox": "0 0 24 24",
    "children": [
      {
        "tag": "path",
        "attrs": {
          "d": "M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"
        }
      },
      {
        "tag": "path",
        "attrs": {
          "d": "M16 14v6"
        }
      },
      {
        "tag": "path",
        "attrs": {
          "d": "M8 14v6"
        }
      },
      {
        "tag": "path",
        "attrs": {
          "d": "M12 16v6"
        }
      }
    ]
  },
  "sprout": {
    "viewBox": "0 0 24 24",
    "children": [
      {
        "tag": "path",
        "attrs": {
          "d": "M14 9.536V7a4 4 0 0 1 4-4h1.5a.5.5 0 0 1 .5.5V5a4 4 0 0 1-4 4 4 4 0 0 0-4 4c0 2 1 3 1 5a5 5 0 0 1-1 3"
        }
      },
      {
        "tag": "path",
        "attrs": {
          "d": "M4 9a5 5 0 0 1 8 4 5 5 0 0 1-8-4"
        }
      },
      {
        "tag": "path",
        "attrs": {
          "d": "M5 21h14"
        }
      }
    ]
  }
});
