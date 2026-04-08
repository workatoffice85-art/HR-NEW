const fs = require('fs');
const https = require('https');
const path = require('path');

const modelsDir = path.join(__dirname, 'models');

if (!fs.existsSync(modelsDir)) {
    fs.mkdirSync(modelsDir);
}

const baseURL = 'https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights/';

const files = [
    'ssd_mobilenetv1_model-weights_manifest.json',
    'ssd_mobilenetv1_model-shard1',
    'ssd_mobilenetv1_model-shard2',
    'face_landmark_68_model-weights_manifest.json',
    'face_landmark_68_model-shard1',
    'face_recognition_model-weights_manifest.json',
    'face_recognition_model-shard1',
    'face_recognition_model-shard2'
];

function downloadFile(filename) {
    const filePath = path.join(modelsDir, filename);
    const url = baseURL + filename;

    https.get(url, (response) => {
        if(response.statusCode === 200) {
            const fileStream = fs.createWriteStream(filePath);
            response.pipe(fileStream);
            fileStream.on('finish', () => {
                fileStream.close();
                console.log(`Downloaded: ${filename}`);
            });
        } else if (response.statusCode === 404) {
             console.log(`Not found: ${filename}`); // some models only have shard1
        }
    }).on('error', (err) => {
        console.error(`Error downloading ${filename}: ${err.message}`);
    });
}

files.forEach(downloadFile);
console.log("Started downloading face-api models...");
