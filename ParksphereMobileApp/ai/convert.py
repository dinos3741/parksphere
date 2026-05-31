import tensorflow as tf
from tensorflow.keras import layers, models

WINDOW_SIZE = 30
FEATURES = ['speed', 'stepRate', 'accel', 'pgr', 'pgrSlope', 'approachAlignment', 'deltaRate']

def build_model(input_shape):
    model = models.Sequential([
        tf.keras.Input(shape=input_shape),
        layers.Conv1D(32, kernel_size=3, activation='relu'),
        layers.BatchNormalization(),
        layers.MaxPooling1D(pool_size=2),
        layers.Conv1D(64, kernel_size=3, activation='relu'),
        layers.BatchNormalization(),
        layers.GlobalAveragePooling1D(),
        layers.Dense(32, activation='relu'),
        layers.Dropout(0.3),
        layers.Dense(1, activation='sigmoid')
    ])
    return model

model = build_model((WINDOW_SIZE, len(FEATURES)))
model.load_weights('ParksphereMobileApp/ai/returning_cnn_model.h5')
# Instead of using h5, save to native SavedModel format which is more robust
model.export('ParksphereMobileApp/ai/saved_model')
