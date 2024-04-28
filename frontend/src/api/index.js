
async function browse(path){
    const response = await fetch(`http://localhost:3000/browse/${path}`);
    return response.json();
}

async function getVolumes(){
    const response = await fetch(`http://localhost:3000/volumes`);
    return response.json();
}

export {
    browse, 
    getVolumes
}





// async function fetchData(url, method, payload, signal = undefined) {
//     let response;
//     if (method === 'POST') {
//         response = await fetch(url, {
//             method: "POST",
//             headers: { 
//                 "Content-Type": "application/json",
//                 // "Authorization": `Bearer ${auth.getAccessToken()}`
//             },
//             body: JSON.stringify(payload),
//             signal:signal
//         });
//     } else {
//         response = await fetch(`${url}?query_message="${payload.query_message}"`, {signal});
//     }
//     return response;
// }