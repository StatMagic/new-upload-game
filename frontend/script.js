// --- CONFIGURATION ---
// <<< IMPORTANT >>>: Replace this URL with your actual API Gateway Invoke URL from Phase 1, Step 4.
const API_GATEWAY_URL =
  "https://esc6t1blhc.execute-api.ap-south-1.amazonaws.com/default/uploadVideo";
const BUCKET_NAME = "playernation-mobileapp-uploads";
const BUCKET_REGION = "ap-south-1";

// --- STATE ---
let modifiedZipBlob = null; // To hold the newly generated zip file
let zipDataCache = null; // To hold parsed zip data AND the raw zip content
let currentZipFile = null; // To explicitly track the selected zip file

// --- DOM ELEMENTS ---
const gameNameInput = document.getElementById("gameName");
const folderNameInput = document.getElementById("folderName");
const zipFileInput = document.getElementById("zipFile");
const zipFileNameDisplay = document.getElementById("zip-file-name");
const uploadButton = document.getElementById("uploadButton");
const progressContainer = document.getElementById("progress-container");
const singleVideoInput = document.getElementById("videoFile");
const resultContainer = document.getElementById("result-container");
const s3FolderLink = document.getElementById("s3-folder-link");
const s3ObjectLink = document.getElementById("s3-object-link");
const videoObjectLinkContainer = document.getElementById(
  "video-object-link-container"
);
const copyFolderLinkButton = document.getElementById("copy-folder-link-button");
const copyVideoLinkButton = document.getElementById("copy-video-link-button");
const packagesModal = document.getElementById("packages-modal");
const playerListContainer = document.getElementById("player-list-container");
const savePackagesButton = document.getElementById("save-packages-button");
const editPackagesButton = document.getElementById("edit-packages-button");
const cancelPackagesButton = document.getElementById("cancel-packages-button");

// --- EVENT LISTENERS ---
copyFolderLinkButton.addEventListener("click", () =>
  copyLinkToClipboard(s3FolderLink.href, copyFolderLinkButton)
);
copyVideoLinkButton.addEventListener("click", () =>
  copyLinkToClipboard(s3ObjectLink.href, copyVideoLinkButton)
);
function getContentTypeFromKey(key) {
  const ext = key.split(".").pop().toLowerCase();

  const map = {
    mp4: "video/mp4",
    mov: "video/quicktime",
    webm: "video/webm",
    mkv: "video/x-matroska",
    avi: "video/x-msvideo",
  };

  return map[ext] || "application/octet-stream";
}
function copyLinkToClipboard(link, buttonElement) {
  if (!link || link === "#") return;
  navigator.clipboard
    .writeText(link)
    .then(() => {
      const originalContent = buttonElement.innerHTML;
      buttonElement.textContent = "Copied!";
      buttonElement.style.color = "#28a745";
      setTimeout(() => {
        buttonElement.innerHTML = originalContent;
        buttonElement.style.color = "white";
      }, 2000);
    })
    .catch((err) => {
      console.error("Failed to copy link: ", err);
      alert("Failed to copy link.");
    });
}

zipFileInput.addEventListener("change", async (event) => {
  const newFile = event.target.files[0];
  if (newFile) {
    currentZipFile = newFile;
    zipFileNameDisplay.textContent = currentZipFile.name;
    resetZipState();
    editPackagesButton.style.display = "inline-block";
  } else {
    console.log("File selection cancelled, preserving previous state.");
  }
});

editPackagesButton.addEventListener("click", async () => {
  if (zipDataCache) {
    packagesModal.style.display = "flex";
    return;
  }
  if (!currentZipFile) {
    alert("Please select a zip file first.");
    return;
  }
  uploadButton.disabled = true;
  uploadButton.textContent = "Processing Zip...";
  try {
    const fileBuffer = await currentZipFile.arrayBuffer();
    const zip = await JSZip.loadAsync(fileBuffer);
    const playerCsvFile = zip.file("players.csv");
    if (!playerCsvFile)
      throw new Error("`players.csv` not found in the zip file.");
    const csvContent = await playerCsvFile.async("string");
    const parseResult = Papa.parse(csvContent, {
      header: true,
      skipEmptyLines: true,
    });
    if (!parseResult.data || parseResult.data.length === 0)
      throw new Error("`players.csv` is empty or invalid.");
    zipDataCache = { players: parseResult.data, zip, rawBuffer: fileBuffer };
    populateAndShowModal();
  } catch (error) {
    alert(`Error processing zip file: ${error.message}`);
    resetZipState();
  } finally {
    uploadButton.disabled = false;
    uploadButton.textContent = "Upload";
  }
});

uploadButton.addEventListener("click", async () => {
  const gameName = gameNameInput.value.trim();
  const finalS3Folder = folderNameInput.value;
  const zipFile = modifiedZipBlob || currentZipFile;
  const videoFile = singleVideoInput.files[0];

  if (!gameName) return alert("Please enter a game name.");

  const allFilesToUpload = [];
  if (videoFile) allFilesToUpload.push(videoFile);
  if (zipFile) allFilesToUpload.push(zipFile);

  if (allFilesToUpload.length === 0)
    return alert("Please select at least a video or a zip file to upload.");
  if (!API_GATEWAY_URL || API_GATEWAY_URL.includes("your-api-gateway")) {
    return alert("Please configure the API_GATEWAY_URL in script.js");
  }

  progressContainer.innerHTML = "<h2>Upload Progress</h2>";
  resultContainer.style.display = "none";
  uploadButton.disabled = true;
  uploadButton.textContent = "Uploading...";

  try {
    const sanitizedGameName = gameName
      .replace(/\s+/g, "-")
      .replace(/[^a-zA-Z0-9-]/g, "")
      .replace(/-+/g, "-") // Replace multiple consecutive hyphens with single hyphen
      .replace(/^-|-$/g, ""); // Remove leading/trailing hyphens

    // Sanitize folder name to ensure it's safe for S3 paths
    const sanitizedFolderName = finalS3Folder
      .replace(/\s+/g, "-") // Replace spaces with hyphens
      .replace(/[^a-zA-Z0-9\-_/]/g, "") // Allow alphanumeric, hyphens, underscores, and slashes
      .replace(/\/+/g, "/") // Remove duplicate slashes
      .replace(/^\/|\/$/g, ""); // Remove leading/trailing slashes

    const uploader = new S3MultipartUploader(allFilesToUpload, {
      gameName: sanitizedGameName,
      finalS3Folder: sanitizedFolderName,
      progressContainer,
    });
    await uploader.upload();

    let objectKey = null;
    if (videoFile) {
      const extension = videoFile.name.split(".").pop();
      objectKey = `full-game-footage/${sanitizedFolderName}/Game-Video/${sanitizedGameName}.${extension}`;
    }

    displayS3Link(BUCKET_NAME, sanitizedFolderName, BUCKET_REGION, objectKey);

    uploadButton.textContent = "Done!";
  } catch (err) {
    console.error("Upload process failed:", err);
    alert(`Upload process failed: ${err.message}`);
    uploadButton.disabled = false;
    uploadButton.textContent = "Upload";
  }
});

async function callBackend(action, params) {
  const response = await fetch(API_GATEWAY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...params }),
  });
  if (!response.ok) {
    const err = await response.json();
    throw new Error(`Backend Error: ${err.error || response.statusText}`);
  }
  return response.json();
}

class S3MultipartUploader {
  constructor(files, options) {
    this.files = files;
    this.options = options;
    this.chunkSize = 10 * 1024 * 1024; // 10MB
  }
  async upload() {
    const allPromises = this.files.map((file) => {
      let displayName = file.name;
      if (!displayName && file instanceof Blob && zipFileInput.files[0]) {
        displayName = zipFileInput.files[0].name;
      }
      return this.uploadFile(file, displayName);
    });
    return Promise.all(allPromises);
  }
  async uploadFile(file, displayName) {
    const progressElement = this.createProgressElement(displayName || "file");
    this.options.progressContainer.appendChild(progressElement);

    const s3Key = `full-game-footage/${this.options.finalS3Folder}/Game-Video/${
      this.options.gameName
    }.${file.name.split(".").pop()}`;

    try {
      if (file.size < this.chunkSize) {
        const { url, contentType } = await callBackend(
          "get-presigned-put-url",
          {
            key: s3Key,
            bucket: BUCKET_NAME,
          }
        );

        await this.uploadSingle(file, url, progressElement, contentType);
      } else {
        await this.uploadMultipart(file, s3Key, progressElement);
      }

      this.updateProgress(progressElement, 1, "Complete");
    } catch (err) {
      console.error(`Upload failed for ${displayName}:`, err);
      this.updateProgress(progressElement, 1, `Error: ${err.message}`);
      throw err;
    }
  }

  async uploadSingle(file, url, progressElement, contentType) {
    await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", url, true);
      xhr.setRequestHeader("Content-Type", contentType);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          this.updateProgress(progressElement, e.loaded / e.total);
        }
      };

      xhr.onload = () =>
        xhr.status >= 200 && xhr.status < 300
          ? resolve()
          : reject(new Error(`HTTP ${xhr.status}`));

      xhr.onerror = () => reject(new Error("Network error"));
      xhr.send(file);
    });
  }

  async uploadMultipart(file, key, progressElement) {
    const { uploadId, contentType } = await callBackend(
      "create-multipart-upload",
      { key, bucket: BUCKET_NAME }
    );

    const totalChunks = Math.ceil(file.size / this.chunkSize);

    const { urls } = await callBackend("get-presigned-part-urls", {
      key,
      uploadId,
      partCount: totalChunks,
      bucket: BUCKET_NAME,
    });

    let uploaded = 0;

    const parts = await Promise.all(
      urls.map((url, index) => {
        const start = index * this.chunkSize;
        const end = Math.min(start + this.chunkSize, file.size);
        const chunk = file.slice(start, end);

        return this.uploadPart(url, chunk, contentType).then((etag) => {
          uploaded++;
          this.updateProgress(progressElement, uploaded / totalChunks);
          return { ETag: etag, PartNumber: index + 1 };
        });
      })
    );

    await callBackend("complete-multipart-upload", {
      key,
      uploadId,
      parts,
      bucket: BUCKET_NAME,
    });
  }

  async uploadPart(url, chunk, contentType) {
    const res = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: chunk,
    });

    if (!res.ok) {
      throw new Error(`Part upload failed: ${res.status}`);
    }

    const etag = res.headers.get("ETag");
    if (!etag) throw new Error("Missing ETag");
    return etag;
  }

  createProgressElement(fileName) {
    const element = document.createElement("div");
    element.classList.add("progress-item");
    element.innerHTML = `<p>${fileName}: <span class="status">Starting...</span><span class="percent-text"></span></p><div class="progress-bar"><div class="progress-bar-inner"></div></div>`;
    return element;
  }
  updateProgress(element, fraction, statusText = null) {
    const progressBarInner = element.querySelector(".progress-bar-inner");
    const percentText = element.querySelector(".percent-text");
    const statusElement = element.querySelector(".status");
    const percent = Math.round(fraction * 100);
    progressBarInner.style.width = `${percent}%`;
    percentText.textContent = ` ${percent}%`;
    if (statusText) {
      statusElement.textContent = statusText;
    } else if (fraction < 1) {
      statusElement.textContent = "Uploading...";
    } else {
      statusElement.textContent = "Processing...";
      statusElement.style.color = "#4CAF50";
    }
  }
}

const displayS3Link = (bucket, folder, region, objectKey = null) => {
  if (!bucket || !folder || !region || bucket.includes("your-unique-bucket")) {
    console.warn(
      "Could not display S3 link. Please configure bucket name and region in script.js"
    );
    return;
  }
  const folderUrl = `https://s3.console.aws.amazon.com/s3/buckets/${bucket}?region=${region}&prefix=full-game-footage/${folder}/`;
  s3FolderLink.href = folderUrl;

  if (objectKey) {
    const encodedObjectKey = objectKey
      .split("/")
      .map(encodeURIComponent)
      .join("/");
    const objectUrl = `https://${bucket}.s3.${region}.amazonaws.com/${encodedObjectKey}`;
    s3ObjectLink.href = objectUrl;
    videoObjectLinkContainer.style.display = "block";
  } else {
    videoObjectLinkContainer.style.display = "none";
  }
  resultContainer.style.display = "block";
};

window.onload = () => {
  const today = new Date();
  const dateString = today.toISOString().split("T")[0];
  folderNameInput.value = `${dateString}-your-game-name`;
};
gameNameInput.addEventListener("input", () => {
  const today = new Date();
  const dateString = today.toISOString().split("T")[0];
  const gameName = gameNameInput.value.trim();
  const sanitizedGameName = gameName
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9-]/g, "");
  folderNameInput.value = gameName
    ? `${dateString}-${sanitizedGameName}`
    : `${dateString}-your-game-name`;
});

function populateAndShowModal() {
  if (!zipDataCache) return;
  playerListContainer.innerHTML = "";
  const playersByTeam = zipDataCache.players.reduce((acc, player) => {
    const teamName = player.team_name || "No Team Assigned";
    if (!acc[teamName]) acc[teamName] = [];
    acc[teamName].push(player);
    return acc;
  }, {});
  for (const teamName in playersByTeam) {
    const teamGroup = document.createElement("div");
    teamGroup.classList.add("team-group");
    teamGroup.innerHTML = `<h3>${teamName}</h3>`;
    playersByTeam[teamName].forEach((player) => {
      const playerName = player.player_name || "Unknown Player";
      const existingPackage = player.PACKAGE_SELECTION || "none";
      const originalIndex = zipDataCache.players.indexOf(player);
      const row = document.createElement("div");
      row.classList.add("player-row");
      row.dataset.index = originalIndex;
      row.innerHTML = `<div class="player-info"><span class="player-name">${playerName}</span></div><div class="package-options"><select><option value="none" ${
        existingPackage === "none" ? "selected" : ""
      }>None</option><option value="stat" ${
        existingPackage === "stat" ? "selected" : ""
      }>Stat Package</option><option value="highlight" ${
        existingPackage === "highlight" ? "selected" : ""
      }>Highlight Package</option><option value="both" ${
        existingPackage === "both" ? "selected" : ""
      }>Both Packages</option></select></div>`;
      teamGroup.appendChild(row);
    });
    playerListContainer.appendChild(teamGroup);
  }
  packagesModal.style.display = "flex";
  savePackagesButton.onclick = () => handleSavePackages();
  cancelPackagesButton.onclick = () => closeModal();
}

function closeModal() {
  packagesModal.style.display = "none";
}

function resetZipState() {
  modifiedZipBlob = null;
  zipDataCache = null;
  editPackagesButton.style.display = "none";
  if (!currentZipFile) {
    zipFileNameDisplay.textContent = "";
  }
}

async function handleSavePackages() {
  if (!zipDataCache) return;
  const playerRows = playerListContainer.querySelectorAll(".player-row");
  const updatedPlayers = [...zipDataCache.players];
  playerRows.forEach((row) => {
    const index = parseInt(row.dataset.index, 10);
    const selectedPackage = row.querySelector("select").value;
    updatedPlayers[index].PACKAGE_SELECTION = selectedPackage;
  });
  const newCsvContent = Papa.unparse(updatedPlayers, { header: true });
  zipDataCache.zip.file("players.csv", newCsvContent);
  try {
    modifiedZipBlob = await zipDataCache.zip.generateAsync({ type: "blob" });
    console.log("New zip file created in memory.");
    packagesModal.style.display = "none";
    uploadButton.disabled = false;
    uploadButton.textContent = "Upload";
    editPackagesButton.style.display = "inline-block";
  } catch (error) {
    alert("Failed to generate the updated zip file. Please try again.");
    console.error("Zip generation error:", error);
    resetZipState();
  }
}
