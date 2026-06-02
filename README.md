# 지방선거 후보 정당 이력 트리

## 로컬 실행

```powershell
npm run dev
```

브라우저에서 `http://localhost:5173`을 엽니다.

## Vercel 배포

이 프로젝트는 Vercel의 정적 파일 + 서버리스 함수 구조를 사용합니다.

- 프론트엔드: `public/`
- 후보 API: `api/candidates.js`
- 공약 API: `api/pledges.js`
- 뉴스 API: `api/news.js`
- 후보 데이터: `data/candidates.json`

Vercel에서 새 프로젝트를 만들고 이 폴더를 배포하면 됩니다. 별도 빌드 명령은 필요하지 않습니다.

Vercel CLI를 사용할 경우:

```powershell
vercel
vercel --prod
```
