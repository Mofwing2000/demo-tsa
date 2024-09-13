import { Steps } from "antd";
import { useState } from "react";
import UploadCertStep from "../../containers/UploadCertStep";
import SignStep from "../../containers/SignStep";

const FullFlow = () => {
    const [step, setStep] = useState(0);
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
                    />
                ) : null}
                {step === 1 ? (
                    <SignStep
                        currentBatchId={currentBatchId}
                        setStep={setStep}
                    />
                ) : null}
            </div>
        </div>
    );
};

export default FullFlow;
