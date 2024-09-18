import { Steps } from "antd";
import { useState } from "react";
import UploadCertStep from "../../containers/UploadCertStep";
import SignStep from "../../containers/SignStep";
import Download from "../../containers/DownloadStep";

const FullFlow = () => {
    const [step, setStep] = useState(0);
    const [selectedCertList, setSelectedCertList] = useState<File[]>([]);
    const [currentBatchId, setCurrentBatchId] = useState<string>("");
    const handleChangeStep = (newStep: number) => {
        setStep(newStep);
    };

    return (
        <div className="p-8">
            <Steps
                current={step}
                items={[
                    {
                        title: "Upload chứng chỉ",
                        // description,
                    },
                    {
                        title: "Ký chứng chỉ",
                        // description,
                    },
                    {
                        title: "Tải về chứng chỉ",
                        // description,
                    },
                ]}
            />
            <div className="mt-20">
                {step === 0 ? (
                    <UploadCertStep
                        setStep={setStep}
                        currentBatchId={currentBatchId}
                        setCurrentBatchId={setCurrentBatchId}
                        selectedCertList={selectedCertList}
                        setSelectedCertList={setSelectedCertList}
                    />
                ) : null}
                {step === 1 ? (
                    <SignStep
                        currentBatchId={currentBatchId}
                        setStep={setStep}
                        totalCertNumber={selectedCertList?.length}
                    />
                ) : null}
                {
                    step === 2 ? (<Download currentBatchId={currentBatchId} setCurrentBatchId={setCurrentBatchId} setStep={setStep} setSelectedCertList={setSelectedCertList}/>) : null
                }
            </div>
        </div>
    );
};

export default FullFlow;
