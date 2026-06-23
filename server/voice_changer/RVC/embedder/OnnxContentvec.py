import torch
import onnxruntime
import numpy as np
from voice_changer.RVC.embedder.Embedder import Embedder


class OnnxContentvec(Embedder):

    def loadModel(self, file: str, dev: torch.device) -> Embedder:
        super().setProps("contentvec", file, dev, False)
        providers = ["CPUExecutionProvider"]
        if dev.type == "cuda":
            providers = ["CUDAExecutionProvider", "CPUExecutionProvider"]
        self.model = onnxruntime.InferenceSession(file, providers=providers)
        return self

    def extractFeatures(
        self, feats: torch.Tensor, embOutputLayer=9, useFinalProj=True
    ) -> torch.Tensor:
        output_name = "units9"
        if embOutputLayer == 12:
            output_name = "unit12s" if useFinalProj else "unit12"

        audio = feats.detach().cpu().numpy().astype(np.float32)
        units = self.model.run([output_name], {"audio": audio})[0]
        return torch.from_numpy(units).to(self.dev)
