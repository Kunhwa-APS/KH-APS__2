const http = require('http');

http.get('http://localhost:8080/api/issues', (res) => {
    console.log("Status:", res.statusCode);
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
        console.log("Response starts with:", data.substring(0, 300));
    });
}).on('error', (err) => {
    console.error("Error pinging API:", err.message);
});
