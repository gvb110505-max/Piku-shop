/** bigint를 포함한 객체를 JSON 문자열로 (bigint는 문자열로 변환). */
export const toJson = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x));
