import { Dispatch, SetStateAction, useState } from "react";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import axiosInstance from "../../api/request";
import { Button, notification, Result, Spin } from "antd";

interface IProps {
  currentBatchId: string;
  setCurrentBatchId: (batchId: string) => void;
  setSelectedCertList: (files: File[]) => void;
  setStep: (step: number) => void;
}

enum DOWNLOAD_STATE {
  IDLE = "IDLE",
  PENDING = "PENDING",
  FINISHED = "FINISHED",
}

const Download = ({
  currentBatchId,
  setCurrentBatchId,
  setSelectedCertList,
  setStep,
}: IProps) => {
  // const [progress, setProgress] = useState<number>(0);
  const [downloadState, setDownloadState] = useState<
    keyof typeof DOWNLOAD_STATE
  >(DOWNLOAD_STATE.IDLE);

  const MAX_RETRY = Number(import.meta.env.VITE_MAX_RETRY);
  const CONCURRENT_LIMIT= Number(import.meta.env.VITE_DOWNLOAD_CONCURRENT_LIMIT);

  const downloadAndZipFiles = async (retryLeft: number = MAX_RETRY) => {
    try {
      const fileLinksResponse = await axiosInstance.get<string[]>(
        `/storage/batch-download?batchId=${currentBatchId}`
      );
      const fileLinks = fileLinksResponse.data;
      setDownloadState(DOWNLOAD_STATE.PENDING);
  
      if (!fileLinks?.length) {
        return notification.warning({
          message: "Lô chứng nhận chưa có chứng nhận nào được tải lên",
        });
      }
  
      const zip = new JSZip();
      let filesDownloaded = 0;
      const concurrencyLimit = CONCURRENT_LIMIT;
      let currentIndex = 0;
  
      const downloadFile = async (url: string, index: number, retryLeft: number): Promise<void> => {
        try {
          const response = await axiosInstance(url, { responseType: "arraybuffer" });
          filesDownloaded += 1;
          const pdfFileBuffer = response.data;
  
          const fileName = decodeURIComponent(decodeURIComponent(url.split("/").pop() || `file-${index}.txt`));
          zip.file(fileName, new Blob([pdfFileBuffer]));
  
          // Optional: Progress update here
          // setProgress(Math.floor((filesDownloaded / fileLinks.length) * 100));
        } catch (error) {
          if (retryLeft > 0) {
            console.warn(`Retrying download for ${url}, retries left: ${retryLeft}`);
            await downloadFile(url, index, retryLeft - 1); // Retry logic
          } else {
            throw new Error(`Failed to download file after retries: ${url}`);
          }
        }
      };
  
      const downloadNextFile = async (): Promise<void> => {
        if (currentIndex >= fileLinks.length) return; // No more files to download
        const index = currentIndex; // Capture the current index
        currentIndex += 1; // Increment before starting the next download to avoid overlap
  
        const url = fileLinks[index];
        await downloadFile(url, index, retryLeft);
      };
  
      const queue: Promise<void>[] = [];
  
      // Loop until all files are processed
      while (currentIndex < fileLinks.length || queue.length > 0) {
        // Add new downloads to the queue until concurrency limit is reached
        while (queue.length < concurrencyLimit && currentIndex < fileLinks.length) {
          const promise = downloadNextFile().then(() => {
            // Remove completed promise from queue
            queue.splice(queue.indexOf(promise), 1);
          }).catch((error) => {
            console.error("Failed to download a file:", error);
            // Handle overall failure scenario if needed
            setDownloadState(DOWNLOAD_STATE.IDLE);
            notification.error({
              message: 'Lỗi khi tải file, vui lòng tải lại'
            });
            return; // Exit the loop
          });
          queue.push(promise); // Add to the queue
        }
  
        // Wait for one of the downloads to complete
        await Promise.race(queue);
      }
  
      // Generate ZIP after all downloads are complete
      const zipBlob = await zip.generateAsync({ type: "blob" });
      saveAs(zipBlob, "Danh sách chứng nhận.zip");
      setDownloadState(DOWNLOAD_STATE.FINISHED);
    } catch (e) {
      console.log('Error during download process:', e);
      if (retryLeft > 0) {
        downloadAndZipFiles(retryLeft - 1);
      } else {
        notification.error({
          message: "Đã có lỗi trong quá trình tải các chứng nhận.",
        });
        setDownloadState(DOWNLOAD_STATE.IDLE);
      }
    }
  };

  const handleUploadNewBatch = () => {
    setStep(0);
    setSelectedCertList([]);
    setCurrentBatchId("");
  };

  return downloadState === DOWNLOAD_STATE.FINISHED ? (
    <Result
      status="success"
      title="Đã tải thành công các chứng nhận!"
      extra={[
        <Button type="primary" onClick={handleUploadNewBatch}>
          Tải lên đợt mới
        </Button>,
      ]}
    />
  ) : (
    <div className="flex flex-col items-center">
      <div className="text-center mb-20">
        Các chứng nhận đã được ký thành công. Bạn có thể tiến hành tải về các
        chứng nhận đã được ký.
      </div>
      <Button
        type="primary"
        onClick={() => downloadAndZipFiles(3)}
        loading={downloadState === DOWNLOAD_STATE.PENDING}
      >
        Tải về
      </Button>
    </div>
  );
};

export default Download;
