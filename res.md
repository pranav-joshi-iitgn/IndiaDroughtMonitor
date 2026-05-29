```js
const q = `
    SELECT *
    FROM csv('./states_with_boundaries.csv', {
        headers:true,
        separator:','
    })
    WHERE CAST([value] AS INT) = 1
`;
```