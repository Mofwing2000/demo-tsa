import React, { useEffect, useRef, useState } from "react";
import { IcRefresh } from "../../assets";
import {
  Button,
  notification,
  Radio,
  RadioChangeEvent,
  Space,
  Tooltip,
  Modal,
  Spin,
  Progress,
} from "antd";
import useSign from "../../hooks/useSign";
import axiosInstance from "../../api/request";

interface IProps {
  currentBatchId: string;
  setStep: React.Dispatch<React.SetStateAction<number>>;
  totalCertNumber: number;
}

type SetNumberData = number;
type HashCert = {
  certId: string;
  signatureId: string;
  sh: string;
};

type FailSet = {
  failCerts?: HashCert[];
};

enum SIGN_STATUS {
  INIT = "INIT",
  PENDING = "PENDING",
  PROCESSED = "PROCESSED",
  ERROR = "ERROR",
  RETRYING = "RETRYING",
  SUCCEED = "SUCCEED",
}

const SignStep = ({ currentBatchId, setStep, totalCertNumber }: IProps) => {
  const [selectedAlias, setSelectedAlias] = useState<string>();
  const [aliases, setAliases] = useState<string[]>([]);
  const [failedSets, setFailedSets] = useState<Record<string, FailSet>>({});
  const [signStatus, setSignStatus] =
    useState<keyof typeof SIGN_STATUS>("INIT");

  //timer
  const [signDuration, setSignDuration] = useState<number | undefined>();
  const batchProgressIntervalRef = useRef<number>();
  const [loading, setLoading] = useState(false);
  const [signedNumber, setSignedNumber] = useState(0);

  const { getUSBAliases, signMessage } = useSign();
  let _eventSource: any = null;

  const MAX_RETRY = import.meta.env.VITE_MAX_RETRY;
  const SWEEP_INTERVAL= import.meta.env.VITE_DATA_SWEEP_INTERVAL;

  const { confirm } = Modal;

  const showConfirm = () => {
    confirm({
      title: "Bạn có chắc chắn muốn ký usb cho các chứng nhận trên?",
      onOk() {
        signUSB();
      },
      onCancel() {
        console.log("Cancel");
      },
    });
  };

  const handleClickSign = () => {
    if (!selectedAlias)
      return notification.warning({
        message: "Vui lòng chọn usb bạn muốn ký!",
      });
    showConfirm();
  };

  const signCertWithRetry = async (
    cert: HashCert,
    offset: number,
    batchId: string,
    retries: number = MAX_RETRY
  ) => {
    try {
      const signedHashCert = await signMessage(selectedAlias!, cert?.sh);
      setSignedNumber((prev) => prev + 1);
      return signedHashCert;
    } catch {
      if (retries > 1) {
        await signCertWithRetry(cert, offset, batchId, retries - 1);
      } else {
        setFailedSets((prev) => ({
          ...prev,
          [`set-${offset}`]: {
            ...prev?.[`set-${offset}`],
            failCerts: [...(prev?.[`set-${offset}`]?.failCerts || []), cert],
          },
        }));
      }
    }
  };

  const signUsbSetCertWithRetry = async (
    offset: number,
    batchId: string,
    retries: number = MAX_RETRY
  ) => {
    try {
      const signedHashCerts = [];
      const hashCertSetResponse = await axiosInstance.get<HashCert[]>(
        `/sign/hashes/${batchId}?offset=${offset}&sigIdx=0`
      );
      for (let cert of hashCertSetResponse?.data) {
        const signedHashCert = await signCertWithRetry(
          cert,
          offset,
          batchId,
          3
        );
        signedHashCerts.push({
          ...cert,
          signature: signedHashCert,
        });
      }
      const signPayload = {
        sig: signedHashCerts,
        batchId,
        offset,
      };
      await axiosInstance.post("/batches/sign", signPayload);
    } catch {
      if (retries > 1)
        await signUsbSetCertWithRetry(offset, batchId, retries - 1);
      else {
        setFailedSets((prev) => ({
          ...prev,
          [`set-${offset}`]: {},
        }));
      }
    }
  };

  const signUSB = async () => {
    try {
      setSignDuration(undefined);
      setSignStatus(SIGN_STATUS.PENDING);
      const initTime = Date.now();
      // initEventSource(currentBatchId, initTime);
      const responseGetSetNumber = await axiosInstance.get<SetNumberData>(
        `/batches/set-quantity/${currentBatchId}`
      );
      if (responseGetSetNumber?.data) {
        // const concurrencyLimit = 5;
        // let currentIndex = 0;
        // const queue: Promise<void>[] = [];

        // while (currentIndex < responseGetSetNumber?.data || queue.length > 0) {
        //   // While we're below the concurrency limit, start new uploads
        //   while (
        //     queue.length < concurrencyLimit &&
        //     currentIndex < responseGetSetNumber?.data
        //   ) {
        //     const uploadPromise = signUsbSetCertWithRetry(
        //       currentIndex,
        //       currentBatchId,
        //       3
        //     ).then(() => {
        //       // Remove the completed promise from the queue
        //       queue.splice(queue.indexOf(uploadPromise), 1);
        //     });
        //     queue.push(uploadPromise); // Add the promise to the queue
        //   }

        //   // Wait for one of the ongoing uploads to finish before starting a new one
        //   await Promise.race(queue);
        // }

        // sign one by one
        for (let i = 0; i < responseGetSetNumber?.data; i++) {
          await signUsbSetCertWithRetry(i, currentBatchId, 3);
        }
        batchProgressIntervalRef.current = setInterval(() => {
          sweepData(currentBatchId, totalCertNumber);
        }, SWEEP_INTERVAL);
      }
      setSignStatus(SIGN_STATUS.PROCESSED);
    } catch {
      notification.error({
        message: "Đã có lỗi trong quá trình ký",
      });
      setSignStatus(SIGN_STATUS.ERROR);
    }
  };

  const getAliases = async () => {
    try {
      setLoading(true);
      const listAliases = await getUSBAliases();
      setAliases(listAliases);
    } catch {
      notification.error({
        message:
          "Có lỗi trong quá trình lấy danh sách usb ký số. Vui lòng thử lại!",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleChooseAlias = (e: RadioChangeEvent) => {
    setSelectedAlias(e?.target?.value);
  };

  const retryFailCertSign = (batchId: string) => {
    setFailedSets({});
    Object.keys(failedSets).forEach(async (key) => {
      const failCerts = failedSets?.[key]?.failCerts;
      const offset = Number(key?.split("-")?.[1]);
      if (failCerts) {
        failCerts?.forEach(async (cert) => {
          await signCertWithRetry(cert, offset, batchId, 1);
        });
      } else await signUsbSetCertWithRetry(offset, batchId, 1);
    });
  };

  // const initEventSource = (batchId: string, initTime: number) => {
  //   const url = BASE_URL + `/batches/${batchId}/signed`;
  //   _eventSource = new EventSource(url);
  //   (_eventSource as EventSource).onmessage = () => {
  //     notification.success({
  //       message: `Đã ký thành công tất cả chứng nhận`,
  //     });
  //     setSignDuration((Date.now() - initTime) / 100);
  //     setSignStatus(SIGN_STATUS.SUCCEED);
  //     _eventSource.close();
  //   };
  // };

  // useEffect(() => {
  //   return () => {
  //     _eventSource?.close();
  //   };
  // }, []);

  const sweepData = async (batchId: string, totalCertNumber: number) => {
    const getBatchProgressResponse = await axiosInstance.get(
      `/batches/get-progress/${batchId}`
    );
    if (
      getBatchProgressResponse?.data?.status === "SIGNED" &&
      getBatchProgressResponse?.data?.docCount === totalCertNumber
    ) {
      clearInterval(batchProgressIntervalRef.current);
      setSignStatus(SIGN_STATUS.SUCCEED);
      notification.success({
        message: "Đã ký và xử lý thành công tất cả chứng nhận.",
      });
    }
  };

  const getMessageTitle = () => {
    if (signStatus === SIGN_STATUS.PENDING)
      return `Đang ký: ${signedNumber}/${totalCertNumber} chứng nhận đã ký thành công`;
    if (signStatus === SIGN_STATUS.PROCESSED)
      return `Tất cả chứng nhận đã được ký. Đang xử lý...`;
    if (signStatus === SIGN_STATUS.SUCCEED)
      return `Tất cả chứng nhận đã được ký và xử lý thành công`;
    if (signStatus === SIGN_STATUS.ERROR)
      return `Đã xảy ra lỗi: ${signedNumber}/${totalCertNumber} chứng nhận đã ký`;
  };

  useEffect(() => {
    getAliases();
  }, []);

  useEffect(() => {
    if (signStatus === SIGN_STATUS.PROCESSED) {
      if (Object.keys(failedSets).length) {
        setSignStatus(SIGN_STATUS.ERROR);
        notification.error({
          message: "Đã có lỗi trong quá trình ký, vui lòng thử lại",
        });
      } else {
        notification.warning({
          message:
            "Đã ký thành công tất cả chứng nhận. Vui lòng chờ hệ thống xử lý trong ít phút",
        });
      }
    }
  }, [signStatus, failedSets]);

  return (
    <div className="flex items-center flex-col">
      {signStatus === SIGN_STATUS.INIT ? (
        <div className="w-full max-w-sm md:max-w-md grow border border-solid rounded-lg border-slate-300 p-6 shrink-0 flex-1">
          <div className="flex justify-between items-center mb-6">
            <div className="text-xl font-bold">Danh sách USB ký số:</div>
            <Tooltip title="Cập nhật danh sách usb">
              <span className="cursor-pointer" onClick={getAliases}>
                <IcRefresh />
              </span>
            </Tooltip>
          </div>

          <div className="min-h-64 ">
            {aliases?.length > 0 ? (
              <Radio.Group
                className="w-full"
                onChange={handleChooseAlias}
                value={selectedAlias}
              >
                <Space
                  direction="vertical"
                  className="px-1 py-2 w-full hover:bg-slate-200 rounded-lg transition ease-in-out delay-150"
                  onClick={() => setSelectedAlias(selectedAlias)}
                >
                  {aliases.map((alias) => (
                    <Radio value={alias}>{alias}</Radio>
                  ))}
                </Space>
              </Radio.Group>
            ) : (
              "Không tìm thấy usb ký số"
            )}
            {loading ? <Spin className="w-full h-full" /> : null}
          </div>
          {/* <div className="flex gap-x-8 items-center justify-center">
          Thời gian ký: {signDuration || ""}
        </div> */}
        </div>
      ) : (
        <Progress
          size={200}
          type="circle"
          percent={Number(((signedNumber * 100) / totalCertNumber).toFixed(0))}
          status={
            signStatus === SIGN_STATUS.PENDING ||
            signStatus === SIGN_STATUS.PROCESSED ||
            signStatus === SIGN_STATUS.RETRYING
              ? "normal"
              : signStatus === SIGN_STATUS.SUCCEED
              ? "success"
              : "exception"
          }
          //   success={{
          //     percent: Number(
          //       (
          //         (succeedFiles?.length * 100) /
          //         selectedCertList?.length
          //       ).toFixed(0)
          //     ),
          //   }}
          format={() => (
            <div
              style={{
                fontSize: "14px",
                maxWidth: "80%",
                textAlign: "center",
                margin: "10%",
              }}
            >
              {getMessageTitle()}
            </div>
          )}
        />
      )}
      <div className="max-w-sm md:max-w-lg grow flex justify-center mt-10">
        {signStatus === SIGN_STATUS.INIT ||
        signStatus === SIGN_STATUS.PROCESSED ||
        signStatus === SIGN_STATUS.PENDING ? (
          <Button
            className="w-24"
            type="primary"
            onClick={handleClickSign}
            loading={
              signStatus === SIGN_STATUS.PENDING ||
              signStatus === SIGN_STATUS.PROCESSED
            }
          >
            Ký
          </Button>
        ) : null}
        {signStatus === SIGN_STATUS.ERROR || signStatus === SIGN_STATUS.RETRYING ? (
          <Button
            className="w-24"
            type="primary"
            danger
            onClick={() => retryFailCertSign(currentBatchId)}
            loading={signStatus === SIGN_STATUS.RETRYING}
          >
            Thử lại
          </Button>
        ) : null}
        {signStatus === SIGN_STATUS.SUCCEED ? (
          <Button
            className="w-24"
            type="primary"
            onClick={() => setStep((step) => step + 1)}
          >
            Tiếp theo
          </Button>
        ) : null}
      </div>
    </div>
  );
};

export default SignStep;
